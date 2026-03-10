;; title: treasury-proposals
;; version: 1.0.0
;; summary: Reputation-weighted treasury spend proposals for pegged agent DAOs.
;; description: Any DAO member with reputation can propose treasury spends.
;; 80% reputation-weighted approval required. Replaces guardian small-spend
;; authority with fully democratic governance. No privileged actors.

;; TRAITS
(impl-trait .dao-traits.extension)

;; CONSTANTS
(define-constant VOTING_PERIOD u144) ;; ~1 day in blocks
(define-constant APPROVAL_THRESHOLD u8000) ;; 80%
(define-constant BASIS_POINTS u10000)

;; Error codes (6500 range)
(define-constant ERR_NOT_AUTHORIZED (err u6500))
(define-constant ERR_NO_REPUTATION (err u6501))
(define-constant ERR_PROPOSAL_NOT_FOUND (err u6502))
(define-constant ERR_ALREADY_VOTED (err u6503))
(define-constant ERR_VOTING_NOT_ENDED (err u6504))
(define-constant ERR_ALREADY_CONCLUDED (err u6505))
(define-constant ERR_ZERO_AMOUNT (err u6506))
(define-constant ERR_VOTING_ENDED (err u6507))

;; DATA VARS
(define-data-var proposal-count uint u0)
(define-data-var approval-threshold uint APPROVAL_THRESHOLD)

;; DATA MAPS

;; Proposal records
(define-map Proposals
  uint
  {
    proposer: principal,
    recipient: principal,
    amount: uint,
    memo: (buff 34),
    rep-for: uint,
    rep-against: uint,
    total-rep-snapshot: uint,
    status: (string-ascii 10),
    created-at: uint,
    end-block: uint
  }
)

;; Vote records
(define-map ProposalVotes
  { proposal-id: uint, voter: principal }
  { in-favor: bool, reputation: uint }
)

;; ============================================================
;; EXTENSION CALLBACK
;; ============================================================

(define-public (callback (sender principal) (memo (buff 34)))
  (ok true)
)

;; ============================================================
;; PROPOSE
;; ============================================================

;; Create a new treasury spend proposal
(define-public (propose (amount uint) (recipient principal) (memo (buff 34)))
  (let
    (
      (proposer tx-sender)
      (proposer-rep (contract-call? .reputation-registry get-reputation proposer))
      (total-rep (contract-call? .reputation-registry get-total-reputation))
      (new-id (+ (var-get proposal-count) u1))
    )
    (asserts! (> proposer-rep u0) ERR_NO_REPUTATION)
    (asserts! (> amount u0) ERR_ZERO_AMOUNT)
    (var-set proposal-count new-id)
    (map-set Proposals new-id {
      proposer: proposer,
      recipient: recipient,
      amount: amount,
      memo: memo,
      rep-for: u0,
      rep-against: u0,
      total-rep-snapshot: total-rep,
      status: "active",
      created-at: stacks-block-height,
      end-block: (+ stacks-block-height VOTING_PERIOD)
    })
    (print {
      notification: "treasury-proposals/propose",
      payload: {
        id: new-id, proposer: proposer, recipient: recipient,
        amount: amount, end-block: (+ stacks-block-height VOTING_PERIOD)
      }
    })
    (ok new-id)
  )
)

;; ============================================================
;; VOTE
;; ============================================================

;; Cast a reputation-weighted vote on a proposal
(define-public (vote (proposal-id uint) (in-favor bool))
  (let
    (
      (voter tx-sender)
      (voter-rep (contract-call? .reputation-registry get-reputation voter))
      (proposal (unwrap! (map-get? Proposals proposal-id) ERR_PROPOSAL_NOT_FOUND))
    )
    (asserts! (> voter-rep u0) ERR_NO_REPUTATION)
    (asserts! (is-eq (get status proposal) "active") ERR_ALREADY_CONCLUDED)
    (asserts! (<= stacks-block-height (get end-block proposal)) ERR_VOTING_ENDED)
    (asserts! (is-none (map-get? ProposalVotes { proposal-id: proposal-id, voter: voter })) ERR_ALREADY_VOTED)
    ;; Record vote
    (map-set ProposalVotes { proposal-id: proposal-id, voter: voter }
      { in-favor: in-favor, reputation: voter-rep }
    )
    ;; Update tallies
    (map-set Proposals proposal-id
      (merge proposal {
        rep-for: (if in-favor (+ (get rep-for proposal) voter-rep) (get rep-for proposal)),
        rep-against: (if in-favor (get rep-against proposal) (+ (get rep-against proposal) voter-rep))
      })
    )
    (print {
      notification: "treasury-proposals/vote",
      payload: { proposal-id: proposal-id, voter: voter, in-favor: in-favor, reputation: voter-rep }
    })
    (ok true)
  )
)

;; ============================================================
;; CONCLUDE
;; ============================================================

;; Conclude a proposal after the voting period. Anyone can call.
(define-public (conclude (proposal-id uint))
  (let
    (
      (proposal (unwrap! (map-get? Proposals proposal-id) ERR_PROPOSAL_NOT_FOUND))
      (total-rep (get total-rep-snapshot proposal))
      (rep-for (get rep-for proposal))
      (threshold (var-get approval-threshold))
      (passed (and
        (> total-rep u0)
        (>= (* rep-for BASIS_POINTS) (* total-rep threshold))
      ))
    )
    (asserts! (is-eq (get status proposal) "active") ERR_ALREADY_CONCLUDED)
    (asserts! (> stacks-block-height (get end-block proposal)) ERR_VOTING_NOT_ENDED)
    ;; Update status
    (map-set Proposals proposal-id
      (merge proposal {
        status: (if passed "passed" "failed")
      })
    )
    ;; If passed, execute the treasury spend
    (if passed
      (begin
        (try! (contract-call? .dao-treasury withdraw-ft .mock-sbtc (get amount proposal) (get recipient proposal)))
        (print {
          notification: "treasury-proposals/concluded-passed",
          payload: {
            proposal-id: proposal-id, amount: (get amount proposal),
            recipient: (get recipient proposal), rep-for: rep-for, total-rep: total-rep
          }
        })
      )
      (print {
        notification: "treasury-proposals/concluded-failed",
        payload: {
          proposal-id: proposal-id, amount: u0,
          recipient: (get recipient proposal), rep-for: rep-for, total-rep: total-rep
        }
      })
    )
    (ok passed)
  )
)

;; ============================================================
;; DAO GOVERNANCE
;; ============================================================

;; Change the approval threshold (DAO-only)
(define-public (set-approval-threshold (threshold uint))
  (begin
    (try! (is-dao-or-extension))
    (asserts! (and (> threshold u0) (<= threshold BASIS_POINTS)) ERR_ZERO_AMOUNT)
    (var-set approval-threshold threshold)
    (ok true)
  )
)

;; ============================================================
;; READ-ONLY FUNCTIONS
;; ============================================================

(define-read-only (get-proposal (proposal-id uint))
  (map-get? Proposals proposal-id)
)

(define-read-only (get-proposal-count)
  (var-get proposal-count)
)

(define-read-only (get-vote (proposal-id uint) (voter principal))
  (map-get? ProposalVotes { proposal-id: proposal-id, voter: voter })
)

(define-read-only (get-approval-threshold)
  (var-get approval-threshold)
)

;; ============================================================
;; PRIVATE FUNCTIONS
;; ============================================================

(define-private (is-dao-or-extension)
  (ok (asserts!
    (or
      (is-eq tx-sender .base-dao)
      (contract-call? .base-dao is-extension contract-caller)
    )
    ERR_NOT_AUTHORIZED
  ))
)
