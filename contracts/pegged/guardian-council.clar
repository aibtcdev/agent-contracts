;; title: guardian-council
;; version: 1.1.0
;; summary: Reputation-based guardian council for pegged agent DAOs.
;; description: Manages a council of 3-5 agents selected by reputation score.
;; Guardians can approve small spends (<2% of treasury per week) without a vote.
;; Can be slashed or removed by 66% reputation-weighted vote (with voting period).
;; Auto-dissolves when the DAO upgrades to free-floating (Phase 2).

;; TRAITS
(impl-trait .dao-traits.extension)

;; CONSTANTS
(define-constant SELF (as-contract tx-sender))
(define-constant MAX_GUARDIANS u5)
(define-constant MIN_GUARDIANS u3)
(define-constant SPEND_LIMIT_BPS u200) ;; 2% of treasury per week
(define-constant WEEK_IN_BLOCKS u1008) ;; ~7 days
(define-constant SLASH_VOTING_PERIOD u144) ;; ~1 day minimum voting window
(define-constant SLASH_THRESHOLD u6600) ;; 66% reputation-weighted
(define-constant MIN_REPUTATION u1) ;; minimum reputation score
(define-constant BASIS_POINTS u10000)

;; Error codes (6100 range)
(define-constant ERR_NOT_AUTHORIZED (err u6100))
(define-constant ERR_NOT_GUARDIAN (err u6101))
(define-constant ERR_SPEND_LIMIT_EXCEEDED (err u6102))
(define-constant ERR_COUNCIL_DISSOLVED (err u6103))
(define-constant ERR_ALREADY_GUARDIAN (err u6104))
(define-constant ERR_MAX_GUARDIANS (err u6105))
(define-constant ERR_MIN_GUARDIANS (err u6106))
(define-constant ERR_ALREADY_VOTED (err u6107))
(define-constant ERR_VOTE_NOT_FOUND (err u6108))
(define-constant ERR_ZERO_AMOUNT (err u6109))
(define-constant ERR_ZERO_REPUTATION (err u6110))
(define-constant ERR_VOTING_NOT_ENDED (err u6111))

;; DATA VARS
(define-data-var dissolved bool false)
(define-data-var guardian-count uint u0)
(define-data-var total-reputation uint u0)
(define-data-var current-week-start uint u0)
(define-data-var current-week-spent uint u0)
(define-data-var slash-vote-count uint u0)

;; DATA MAPS

;; Guardian status and reputation
(define-map Guardians
  principal
  { reputation: uint, joined-at: uint }
)

;; Weekly spend tracking per guardian
(define-map GuardianSpends
  { guardian: principal, week: uint }
  uint
)

;; Slash votes: who voted to remove which guardian
(define-map SlashVotes
  { vote-id: uint, voter: principal }
  bool
)

;; Slash vote data
(define-map SlashVoteData
  uint
  {
    target: principal,
    rep-for: uint,
    rep-against: uint,
    concluded: bool,
    passed: bool,
    created-at: uint
  }
)

;; Reputation scores for all DAO members (seeded from ERC-8004)
(define-map ReputationScores principal uint)

;; ============================================================
;; EXTENSION CALLBACK
;; ============================================================

(define-public (callback (sender principal) (memo (buff 34)))
  (ok true)
)

;; ============================================================
;; GUARDIAN MANAGEMENT
;; ============================================================

;; Add a guardian (DAO-only, typically via init proposal)
(define-public (add-guardian (agent principal) (reputation uint))
  (begin
    (try! (is-dao-or-extension))
    (asserts! (not (var-get dissolved)) ERR_COUNCIL_DISSOLVED)
    (asserts! (is-none (map-get? Guardians agent)) ERR_ALREADY_GUARDIAN)
    (asserts! (< (var-get guardian-count) MAX_GUARDIANS) ERR_MAX_GUARDIANS)
    (asserts! (>= reputation MIN_REPUTATION) ERR_ZERO_REPUTATION)
    (map-set Guardians agent { reputation: reputation, joined-at: stacks-block-height })
    (map-set ReputationScores agent reputation)
    (var-set guardian-count (+ (var-get guardian-count) u1))
    (var-set total-reputation (+ (var-get total-reputation) reputation))
    (print {
      notification: "guardian-council/add-guardian",
      payload: { agent: agent, reputation: reputation, count: (var-get guardian-count) }
    })
    (ok true)
  )
)

;; Remove a guardian (DAO-only or via slash vote)
(define-public (remove-guardian (agent principal))
  (let
    (
      (guardian-data (unwrap! (map-get? Guardians agent) ERR_NOT_GUARDIAN))
      (rep (get reputation guardian-data))
    )
    (try! (is-dao-or-extension))
    (map-delete Guardians agent)
    (var-set guardian-count (- (var-get guardian-count) u1))
    (var-set total-reputation (- (var-get total-reputation) rep))
    (print {
      notification: "guardian-council/remove-guardian",
      payload: { agent: agent, count: (var-get guardian-count) }
    })
    (ok true)
  )
)

;; Update reputation score for any DAO member
;; [H4 FIX] Enforces minimum reputation to prevent zero-total-rep attacks
(define-public (set-reputation (agent principal) (score uint))
  (begin
    (try! (is-dao-or-extension))
    (asserts! (>= score MIN_REPUTATION) ERR_ZERO_REPUTATION)
    (map-set ReputationScores agent score)
    ;; If they're a guardian, update their guardian record too
    (match (map-get? Guardians agent)
      guardian-data
        (begin
          (var-set total-reputation (- (var-get total-reputation) (get reputation guardian-data)))
          (map-set Guardians agent { reputation: score, joined-at: (get joined-at guardian-data) })
          (var-set total-reputation (+ (var-get total-reputation) score))
        )
      true ;; not a guardian, no-op
    )
    (ok true)
  )
)

;; ============================================================
;; SMALL SPEND APPROVAL (<2% of treasury per week)
;; ============================================================

;; [C1 FIX] Guardian approves a small sBTC spend from treasury.
;; Reads actual treasury balance on-chain instead of trusting caller input.
;; [M2 FIX] Hardcodes sBTC - no ft trait parameter to prevent token substitution.
(define-public (approve-small-spend (amount uint) (recipient principal))
  (let
    (
      (sender tx-sender)
      (week (get-current-week))
      ;; Read actual treasury sBTC balance on-chain
      (treasury-balance (unwrap-panic (contract-call? .mock-sbtc get-balance .dao-treasury)))
      (week-limit (/ (* treasury-balance SPEND_LIMIT_BPS) BASIS_POINTS))
      (already-spent (get-week-spending sender week))
      (new-total (+ already-spent amount))
    )
    (asserts! (not (var-get dissolved)) ERR_COUNCIL_DISSOLVED)
    (asserts! (is-guardian sender) ERR_NOT_GUARDIAN)
    (asserts! (> amount u0) ERR_ZERO_AMOUNT)
    (asserts! (<= new-total week-limit) ERR_SPEND_LIMIT_EXCEEDED)
    ;; Track spend
    (map-set GuardianSpends { guardian: sender, week: week } new-total)
    ;; Reset week tracker if needed
    (if (not (is-eq (var-get current-week-start) week))
      (begin
        (var-set current-week-start week)
        (var-set current-week-spent u0)
      )
      true
    )
    (var-set current-week-spent (+ (var-get current-week-spent) amount))
    ;; Execute the spend via treasury - hardcoded to sBTC only
    (try! (contract-call? .dao-treasury withdraw-ft .mock-sbtc amount recipient))
    (print {
      notification: "guardian-council/approve-small-spend",
      payload: {
        guardian: sender, amount: amount, recipient: recipient,
        week-spent: new-total, week-limit: week-limit,
        treasury-balance: treasury-balance
      }
    })
    (ok true)
  )
)

;; ============================================================
;; SLASH VOTING (66% reputation-weighted to remove a guardian)
;; [H2 FIX] Added mandatory voting period before conclusion
;; ============================================================

;; Start a slash vote against a guardian
(define-public (start-slash-vote (target principal))
  (let
    (
      (voter tx-sender)
      (voter-rep (default-to u0 (map-get? ReputationScores voter)))
      (vote-id (+ (var-get slash-vote-count) u1))
    )
    (asserts! (not (var-get dissolved)) ERR_COUNCIL_DISSOLVED)
    (asserts! (is-guardian target) ERR_NOT_GUARDIAN)
    (asserts! (> voter-rep u0) ERR_ZERO_REPUTATION)
    (var-set slash-vote-count vote-id)
    (map-set SlashVoteData vote-id {
      target: target,
      rep-for: voter-rep,
      rep-against: u0,
      concluded: false,
      passed: false,
      created-at: stacks-block-height
    })
    (map-set SlashVotes { vote-id: vote-id, voter: voter } true)
    (print {
      notification: "guardian-council/start-slash-vote",
      payload: { vote-id: vote-id, target: target, proposer: voter,
                 end-block: (+ stacks-block-height SLASH_VOTING_PERIOD) }
    })
    (ok vote-id)
  )
)

;; Vote on a slash proposal
(define-public (vote-slash (vote-id uint) (in-favor bool))
  (let
    (
      (voter tx-sender)
      (voter-rep (default-to u0 (map-get? ReputationScores voter)))
      (vote-data (unwrap! (map-get? SlashVoteData vote-id) ERR_VOTE_NOT_FOUND))
    )
    (asserts! (not (var-get dissolved)) ERR_COUNCIL_DISSOLVED)
    (asserts! (not (get concluded vote-data)) ERR_VOTE_NOT_FOUND)
    (asserts! (> voter-rep u0) ERR_ZERO_REPUTATION)
    (asserts! (is-none (map-get? SlashVotes { vote-id: vote-id, voter: voter })) ERR_ALREADY_VOTED)
    (map-set SlashVotes { vote-id: vote-id, voter: voter } true)
    (map-set SlashVoteData vote-id
      (merge vote-data {
        rep-for: (if in-favor (+ (get rep-for vote-data) voter-rep) (get rep-for vote-data)),
        rep-against: (if in-favor (get rep-against vote-data) (+ (get rep-against vote-data) voter-rep))
      })
    )
    (print {
      notification: "guardian-council/vote-slash",
      payload: { vote-id: vote-id, voter: voter, in-favor: in-favor }
    })
    (ok true)
  )
)

;; Conclude a slash vote
;; [H2 FIX] Must wait SLASH_VOTING_PERIOD blocks after creation
(define-public (conclude-slash-vote (vote-id uint))
  (let
    (
      (vote-data (unwrap! (map-get? SlashVoteData vote-id) ERR_VOTE_NOT_FOUND))
      (total-rep (var-get total-reputation))
      (rep-for (get rep-for vote-data))
      ;; 66% of total reputation must vote in favor
      (passed (and
        (> total-rep u0)
        (>= (* rep-for BASIS_POINTS) (* total-rep SLASH_THRESHOLD))
      ))
    )
    (asserts! (not (get concluded vote-data)) ERR_ALREADY_VOTED)
    ;; [H2 FIX] Enforce minimum voting period
    (asserts! (>= stacks-block-height (+ (get created-at vote-data) SLASH_VOTING_PERIOD)) ERR_VOTING_NOT_ENDED)
    (map-set SlashVoteData vote-id
      (merge vote-data { concluded: true, passed: passed })
    )
    ;; If passed, remove the guardian
    (if passed
      (begin
        (try! (remove-guardian-internal (get target vote-data)))
        true
      )
      true
    )
    (print {
      notification: "guardian-council/conclude-slash-vote",
      payload: { vote-id: vote-id, passed: passed, rep-for: rep-for, threshold: SLASH_THRESHOLD }
    })
    (ok passed)
  )
)

;; ============================================================
;; DISSOLVE (called by upgrade-to-free-floating)
;; ============================================================

(define-public (dissolve)
  (begin
    (try! (is-dao-or-extension))
    (var-set dissolved true)
    (print {
      notification: "guardian-council/dissolve",
      payload: { block: stacks-block-height }
    })
    (ok true)
  )
)

;; ============================================================
;; READ-ONLY FUNCTIONS
;; ============================================================

(define-read-only (is-guardian (agent principal))
  (is-some (map-get? Guardians agent))
)

(define-read-only (get-guardian-data (agent principal))
  (map-get? Guardians agent)
)

(define-read-only (get-guardian-count)
  (var-get guardian-count)
)

(define-read-only (get-total-reputation)
  (var-get total-reputation)
)

(define-read-only (is-dissolved)
  (var-get dissolved)
)

(define-read-only (get-reputation (agent principal))
  (default-to u0 (map-get? ReputationScores agent))
)

(define-read-only (get-current-week)
  (/ stacks-block-height WEEK_IN_BLOCKS)
)

(define-read-only (get-week-spending (guardian principal) (week uint))
  (default-to u0 (map-get? GuardianSpends { guardian: guardian, week: week }))
)

(define-read-only (get-weekly-spend-limit (treasury-balance uint))
  (/ (* treasury-balance SPEND_LIMIT_BPS) BASIS_POINTS)
)

(define-read-only (get-slash-vote (vote-id uint))
  (map-get? SlashVoteData vote-id)
)

(define-read-only (get-council-info)
  {
    guardian-count: (var-get guardian-count),
    total-reputation: (var-get total-reputation),
    dissolved: (var-get dissolved),
    current-week: (get-current-week),
    week-spent: (var-get current-week-spent)
  }
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

;; Internal remove (bypasses auth for slash vote conclusion)
(define-private (remove-guardian-internal (agent principal))
  (let
    (
      (guardian-data (unwrap! (map-get? Guardians agent) ERR_NOT_GUARDIAN))
      (rep (get reputation guardian-data))
    )
    (map-delete Guardians agent)
    (var-set guardian-count (- (var-get guardian-count) u1))
    (var-set total-reputation (- (var-get total-reputation) rep))
    (print {
      notification: "guardian-council/slash-removed",
      payload: { agent: agent }
    })
    (ok true)
  )
)
