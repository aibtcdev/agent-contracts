;; title: core-proposals
;; version: 1.0.0
;; summary: Generic proposal voting extension for the DAO
;; description: Token holder voting on proposals with configurable voting delay,
;; period, quorum, and threshold requirements. One token = one vote.

;; TRAITS
(impl-trait .dao-traits.extension)
(impl-trait .dao-traits.core-proposals)

(use-trait proposal-trait .dao-traits.proposal)

;; CONSTANTS

(define-constant SELF (as-contract tx-sender))

;; Voting configuration
;; Voting delay: blocks before voting starts after proposal creation
(define-constant VOTING_DELAY u144)      ;; ~1 day in Stacks blocks
;; Voting period: blocks during which voting is active
(define-constant VOTING_PERIOD u432)     ;; ~3 days in Stacks blocks
;; Quorum: minimum percentage of liquid supply that must vote (basis points)
(define-constant VOTING_QUORUM u1500)    ;; 15% of liquid supply
;; Threshold: minimum percentage of votes that must be FOR (basis points)
(define-constant VOTING_THRESHOLD u6600) ;; 66% approval required
;; Bond: optional token bond required to create proposal (0 = no bond)
(define-constant PROPOSAL_BOND u0)

;; Error codes
(define-constant ERR_NOT_DAO_OR_EXTENSION (err u3000))
(define-constant ERR_FETCHING_TOKEN_DATA (err u3001))
(define-constant ERR_INSUFFICIENT_BALANCE (err u3002))
(define-constant ERR_PROPOSAL_NOT_FOUND (err u3003))
(define-constant ERR_PROPOSAL_VOTING_ACTIVE (err u3004))
(define-constant ERR_PROPOSAL_ALREADY_EXECUTED (err u3005))
(define-constant ERR_SAVING_PROPOSAL (err u3006))
(define-constant ERR_PROPOSAL_ALREADY_CONCLUDED (err u3007))
(define-constant ERR_VOTE_TOO_SOON (err u3008))
(define-constant ERR_VOTE_TOO_LATE (err u3009))
(define-constant ERR_ALREADY_VOTED (err u3010))
(define-constant ERR_PROPOSAL_NOT_PASSED (err u3011))
(define-constant ERR_PROPOSAL_NOT_CONCLUDED (err u3012))
(define-constant ERR_SNAPSHOT_ALREADY_EXISTS (err u3013))

;; DATA VARS

;; Counter for proposal IDs
(define-data-var proposalCount uint u0)

;; DATA MAPS

;; Main proposal storage - keyed by proposal ID
(define-map Proposals uint {
  proposal: principal,          ;; The proposal contract principal
  proposer: principal,          ;; Who created the proposal
  created-at-block: uint,       ;; Stacks block when created (for snapshot)
  start-block: uint,            ;; Block when voting starts
  end-block: uint,              ;; Block when voting ends
  votes-for: uint,              ;; Total votes in favor
  votes-against: uint,          ;; Total votes against
  liquid-tokens: uint,          ;; Liquid supply at creation (for quorum calc)
  concluded: bool,              ;; Whether voting has been concluded
  passed: bool,                 ;; Whether proposal passed
  executed: bool                ;; Whether proposal has been executed
})

;; Track individual votes to prevent double voting
(define-map VoteRecords { proposal-id: uint, voter: principal } {
  amount: uint,
  vote: bool
})

;; Snapshot of voter balances at first vote interaction
;; Once set, this is the immutable voting power for this voter on this proposal
(define-map VoterSnapshots { proposal-id: uint, voter: principal } uint)

;; PUBLIC FUNCTIONS

;; Extension callback (required by extension trait)
(define-public (callback (sender principal) (memo (buff 34)))
  (ok true)
)

;; Create a new proposal for token holder voting
;; Returns the proposal ID
(define-public (create-proposal (proposal <proposal-trait>) (memo (optional (string-ascii 1024))))
  (let
    (
      (proposalContract (contract-of proposal))
      (proposalId (var-get proposalCount))
      (createdAt stacks-block-height)
      (liquidTokens (try! (get-liquid-supply)))
      (startBlock (+ stacks-block-height VOTING_DELAY))
      (endBlock (+ startBlock VOTING_PERIOD))
      (senderBalance (unwrap! (contract-call? .dao-token get-balance tx-sender) ERR_FETCHING_TOKEN_DATA))
    )
    ;; Caller must have tokens to create proposal
    (asserts! (> senderBalance u0) ERR_INSUFFICIENT_BALANCE)
    ;; Proposal was not already executed via base-dao
    (asserts! (is-none (contract-call? .base-dao executed-at proposalContract)) ERR_PROPOSAL_ALREADY_EXECUTED)
    ;; Handle bond if required
    (if (> PROPOSAL_BOND u0)
      (begin
        (asserts! (>= senderBalance PROPOSAL_BOND) ERR_INSUFFICIENT_BALANCE)
        (try! (contract-call? .dao-token transfer PROPOSAL_BOND tx-sender SELF none))
      )
      true
    )
    ;; Store the proposal
    (asserts! (map-insert Proposals proposalId {
      proposal: proposalContract,
      proposer: tx-sender,
      created-at-block: createdAt,
      start-block: startBlock,
      end-block: endBlock,
      votes-for: u0,
      votes-against: u0,
      liquid-tokens: liquidTokens,
      concluded: false,
      passed: false,
      executed: false
    }) ERR_SAVING_PROPOSAL)
    ;; Print event
    (print {
      notification: "core-proposals/create-proposal",
      payload: {
        proposal-id: proposalId,
        proposal: proposalContract,
        proposer: tx-sender,
        created-at-block: createdAt,
        start-block: startBlock,
        end-block: endBlock,
        liquid-tokens: liquidTokens,
        memo: memo,
        voting-delay: VOTING_DELAY,
        voting-period: VOTING_PERIOD,
        voting-quorum: VOTING_QUORUM,
        voting-threshold: VOTING_THRESHOLD
      }
    })
    ;; Increment proposal count and return ID
    (var-set proposalCount (+ proposalId u1))
    (ok proposalId)
  )
)

;; Cast a vote on a proposal
;; vote: true = for, false = against
;; Voting power is locked at first vote via snapshot mechanism
(define-public (vote-on-proposal (proposalId uint) (vote bool))
  (let
    (
      (proposalRecord (unwrap! (map-get? Proposals proposalId) ERR_PROPOSAL_NOT_FOUND))
      ;; Use snapshot balance - creates snapshot on first vote, returns existing if already set
      (senderBalance (try! (get-or-create-snapshot proposalId tx-sender)))
    )
    ;; Caller must have tokens to vote
    (asserts! (> senderBalance u0) ERR_INSUFFICIENT_BALANCE)
    ;; Proposal must not be concluded
    (asserts! (not (get concluded proposalRecord)) ERR_PROPOSAL_ALREADY_CONCLUDED)
    ;; Voting must have started
    (asserts! (>= stacks-block-height (get start-block proposalRecord)) ERR_VOTE_TOO_SOON)
    ;; Voting must not have ended
    (asserts! (< stacks-block-height (get end-block proposalRecord)) ERR_VOTE_TOO_LATE)
    ;; Caller must not have already voted
    (asserts! (is-none (map-get? VoteRecords { proposal-id: proposalId, voter: tx-sender })) ERR_ALREADY_VOTED)
    ;; Record the vote
    (map-set VoteRecords { proposal-id: proposalId, voter: tx-sender } {
      amount: senderBalance,
      vote: vote
    })
    ;; Update proposal vote counts
    (map-set Proposals proposalId
      (if vote
        (merge proposalRecord { votes-for: (+ (get votes-for proposalRecord) senderBalance) })
        (merge proposalRecord { votes-against: (+ (get votes-against proposalRecord) senderBalance) })
      )
    )
    ;; Print event
    (print {
      notification: "core-proposals/vote-on-proposal",
      payload: {
        proposal-id: proposalId,
        voter: tx-sender,
        vote: vote,
        amount: senderBalance
      }
    })
    (ok true)
  )
)

;; Conclude voting on a proposal after voting period ends
;; Determines if proposal passed based on quorum and threshold
(define-public (conclude-proposal (proposalId uint) (proposal <proposal-trait>))
  (let
    (
      (proposalRecord (unwrap! (map-get? Proposals proposalId) ERR_PROPOSAL_NOT_FOUND))
      (votesFor (get votes-for proposalRecord))
      (votesAgainst (get votes-against proposalRecord))
      (totalVotes (+ votesFor votesAgainst))
      (liquidTokens (get liquid-tokens proposalRecord))
      (hasVotes (> totalVotes u0))
      ;; Quorum: totalVotes / liquidTokens >= VOTING_QUORUM / 10000
      ;; Rearranged: totalVotes * 10000 >= liquidTokens * VOTING_QUORUM
      (metQuorum (and hasVotes
        (>= (* totalVotes u10000) (* liquidTokens VOTING_QUORUM))
      ))
      ;; Threshold: votesFor / totalVotes >= VOTING_THRESHOLD / 10000
      ;; Rearranged: votesFor * 10000 >= totalVotes * VOTING_THRESHOLD
      (metThreshold (and hasVotes
        (>= (* votesFor u10000) (* totalVotes VOTING_THRESHOLD))
      ))
      (votePassed (and metQuorum metThreshold))
    )
    ;; Verify the proposal contract matches
    (asserts! (is-eq (contract-of proposal) (get proposal proposalRecord)) ERR_PROPOSAL_NOT_FOUND)
    ;; Proposal must not already be concluded
    (asserts! (not (get concluded proposalRecord)) ERR_PROPOSAL_ALREADY_CONCLUDED)
    ;; Voting period must have ended
    (asserts! (>= stacks-block-height (get end-block proposalRecord)) ERR_PROPOSAL_VOTING_ACTIVE)
    ;; Update proposal record
    (map-set Proposals proposalId
      (merge proposalRecord {
        concluded: true,
        passed: votePassed
      })
    )
    ;; Return bond if applicable
    (if (and (> PROPOSAL_BOND u0) votePassed)
      (try! (as-contract (contract-call? .dao-token transfer PROPOSAL_BOND SELF (get proposer proposalRecord) none)))
      true
    )
    ;; Print event
    (print {
      notification: "core-proposals/conclude-proposal",
      payload: {
        proposal-id: proposalId,
        proposal: (get proposal proposalRecord),
        votes-for: votesFor,
        votes-against: votesAgainst,
        total-votes: totalVotes,
        liquid-tokens: liquidTokens,
        met-quorum: metQuorum,
        met-threshold: metThreshold,
        passed: votePassed
      }
    })
    (ok votePassed)
  )
)

;; Execute a proposal that has passed
;; Anyone can call this after proposal has been concluded and passed
(define-public (execute-proposal (proposalId uint) (proposal <proposal-trait>))
  (let
    (
      (proposalRecord (unwrap! (map-get? Proposals proposalId) ERR_PROPOSAL_NOT_FOUND))
    )
    ;; Verify the proposal contract matches
    (asserts! (is-eq (contract-of proposal) (get proposal proposalRecord)) ERR_PROPOSAL_NOT_FOUND)
    ;; Proposal must be concluded
    (asserts! (get concluded proposalRecord) ERR_PROPOSAL_NOT_CONCLUDED)
    ;; Proposal must have passed
    (asserts! (get passed proposalRecord) ERR_PROPOSAL_NOT_PASSED)
    ;; Proposal must not already be executed
    (asserts! (not (get executed proposalRecord)) ERR_PROPOSAL_ALREADY_EXECUTED)
    ;; Mark as executed
    (map-set Proposals proposalId
      (merge proposalRecord { executed: true })
    )
    ;; Print event
    (print {
      notification: "core-proposals/execute-proposal",
      payload: {
        proposal-id: proposalId,
        proposal: (get proposal proposalRecord),
        executor: tx-sender
      }
    })
    ;; Execute via base-dao
    (try! (contract-call? .base-dao execute proposal tx-sender))
    (ok true)
  )
)

;; READ-ONLY FUNCTIONS

;; Get proposal data (implements core-proposals trait)
(define-read-only (get-proposal-data (proposalId uint))
  (match (map-get? Proposals proposalId)
    proposal (ok {
      proposal: (get proposal proposal),
      proposer: (get proposer proposal),
      created-at-block: (get created-at-block proposal),
      end-block: (get end-block proposal),
      votes-for: (get votes-for proposal),
      votes-against: (get votes-against proposal),
      concluded: (get concluded proposal),
      passed: (get passed proposal)
    })
    ERR_PROPOSAL_NOT_FOUND
  )
)

;; Get full proposal record
(define-read-only (get-proposal (proposalId uint))
  (map-get? Proposals proposalId)
)

;; Get vote record for a voter on a proposal
(define-read-only (get-vote-record (proposalId uint) (voter principal))
  (map-get? VoteRecords { proposal-id: proposalId, voter: voter })
)

;; Get voting power for a proposal
;; Returns snapshot balance if voter has one, otherwise current balance
(define-read-only (get-voting-power (who principal) (proposalId uint))
  (match (map-get? VoterSnapshots { proposal-id: proposalId, voter: who })
    snapshot (ok snapshot)
    (contract-call? .dao-token get-balance who)
  )
)

;; Get current token balance (without proposal context)
(define-read-only (get-current-balance (who principal))
  (contract-call? .dao-token get-balance who)
)

;; Get voter's snapshot for a proposal (none if not yet set)
(define-read-only (get-voter-snapshot (proposalId uint) (voter principal))
  (map-get? VoterSnapshots { proposal-id: proposalId, voter: voter })
)

;; Check if a proposal is currently in voting period
(define-read-only (is-proposal-active (proposalId uint))
  (match (map-get? Proposals proposalId)
    proposal (and
      (not (get concluded proposal))
      (>= stacks-block-height (get start-block proposal))
      (< stacks-block-height (get end-block proposal))
    )
    false
  )
)

;; Get total number of proposals
(define-read-only (get-proposal-count)
  (var-get proposalCount)
)

;; Get voting configuration
(define-read-only (get-voting-configuration)
  {
    voting-delay: VOTING_DELAY,
    voting-period: VOTING_PERIOD,
    voting-quorum: VOTING_QUORUM,
    voting-threshold: VOTING_THRESHOLD,
    proposal-bond: PROPOSAL_BOND
  }
)

;; Get liquid supply for quorum calculation
;; For simplicity, uses total supply. In production, would exclude locked tokens.
(define-private (get-liquid-supply)
  (let
    (
      (supply-response (contract-call? .dao-token get-total-supply))
    )
    (if (is-ok supply-response)
      (ok (unwrap-panic supply-response))
      ERR_FETCHING_TOKEN_DATA
    )
  )
)

;; PRIVATE FUNCTIONS

;; Get voter's snapshot balance, or create one if not exists
;; Uses current balance at first vote (first-vote snapshot)
;; Once created, voting power is locked for this proposal
(define-private (get-or-create-snapshot (proposalId uint) (voter principal))
  (match (map-get? VoterSnapshots { proposal-id: proposalId, voter: voter })
    existing-snapshot (ok existing-snapshot)
    (let
      (
        (snapshot-balance (unwrap! (contract-call? .dao-token get-balance voter) ERR_FETCHING_TOKEN_DATA))
      )
      ;; Record snapshot for this voter
      (map-insert VoterSnapshots { proposal-id: proposalId, voter: voter } snapshot-balance)
      (ok snapshot-balance)
    )
  )
)

;; Authorization check: is caller the DAO or an enabled extension?
(define-private (is-dao-or-extension)
  (ok (asserts!
    (or
      (is-eq tx-sender .base-dao)
      (contract-call? .base-dao is-extension contract-caller)
    )
    ERR_NOT_DAO_OR_EXTENSION
  ))
)
