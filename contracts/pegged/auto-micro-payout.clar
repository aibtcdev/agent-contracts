;; title: auto-micro-payout
;; version: 1.1.0
;; summary: Automatic micro-payouts for verified agent work.
;; description: Pays 100-500 sats from treasury for verified work such as
;; check-ins and proofs. Verifies work against on-chain registries before paying.
;; No vote required. Rate-limited per agent per epoch.
;; [C2 FIX] Verifies work on-chain instead of trusting caller claims.
;; [M2 FIX] Hardcodes sBTC - no ft trait parameter.

;; TRAITS
(impl-trait .dao-traits.extension)

;; CONSTANTS
(define-constant SELF (as-contract tx-sender))
(define-constant MIN_PAYOUT u100) ;; 100 sats minimum
(define-constant MAX_PAYOUT u500) ;; 500 sats maximum
(define-constant MAX_PAYOUTS_PER_EPOCH u10) ;; max 10 payouts per agent per epoch
(define-constant EPOCH_LENGTH u4320) ;; ~30 days in blocks

;; Error codes (6200 range)
(define-constant ERR_NOT_AUTHORIZED (err u6200))
(define-constant ERR_INVALID_AMOUNT (err u6201))
(define-constant ERR_RATE_LIMITED (err u6202))
(define-constant ERR_INVALID_WORK_TYPE (err u6203))
(define-constant ERR_ALREADY_CLAIMED (err u6204))
(define-constant ERR_PAUSED (err u6205))
(define-constant ERR_WORK_NOT_VERIFIED (err u6206))

;; Work type constants
(define-constant WORK_TYPE_CHECKIN u1)
(define-constant WORK_TYPE_PROOF u2)
(define-constant WORK_TYPE_GUARDIAN_APPROVED u3)

;; DATA VARS
(define-data-var paused bool false)
(define-data-var total-paid uint u0)
(define-data-var total-payouts uint u0)

;; DATA MAPS

;; Track payouts per agent per epoch
(define-map AgentEpochPayouts
  { agent: principal, epoch: uint }
  uint
)

;; Track individual work claims to prevent double-payment
(define-map WorkClaims
  { agent: principal, work-type: uint, work-id: uint }
  bool
)

;; Configurable payout amounts per work type
(define-map PayoutAmounts uint uint)

;; Guardian-approved work items (for work types that can't be verified on-chain)
;; Only guardians can approve work for payout
(define-map ApprovedWork
  { agent: principal, work-id: uint }
  { approved-by: principal, amount: uint }
)

;; ============================================================
;; EXTENSION CALLBACK
;; ============================================================

(define-public (callback (sender principal) (memo (buff 34)))
  (ok true)
)

;; ============================================================
;; INITIALIZATION
;; ============================================================

;; Set default payout amounts (called via init proposal)
(define-public (set-payout-amount (work-type uint) (amount uint))
  (begin
    (try! (is-dao-or-extension))
    (asserts! (and (>= amount MIN_PAYOUT) (<= amount MAX_PAYOUT)) ERR_INVALID_AMOUNT)
    (asserts! (and (>= work-type u1) (<= work-type u3)) ERR_INVALID_WORK_TYPE)
    (map-set PayoutAmounts work-type amount)
    (ok true)
  )
)

;; ============================================================
;; GUARDIAN APPROVAL (for work that can't be verified on-chain)
;; ============================================================

;; Guardian pre-approves a work item for an agent
;; This covers x402 replies, inscriptions, signals, bounties, etc.
(define-public (approve-work (agent principal) (work-id uint) (amount uint))
  (begin
    (asserts! (contract-call? .guardian-council is-guardian tx-sender) ERR_NOT_AUTHORIZED)
    (asserts! (and (>= amount MIN_PAYOUT) (<= amount MAX_PAYOUT)) ERR_INVALID_AMOUNT)
    (map-set ApprovedWork
      { agent: agent, work-id: work-id }
      { approved-by: tx-sender, amount: amount }
    )
    (print {
      notification: "auto-micro-payout/approve-work",
      payload: { guardian: tx-sender, agent: agent, work-id: work-id, amount: amount }
    })
    (ok true)
  )
)

;; ============================================================
;; CLAIM PAYOUT FOR VERIFIED WORK
;; [C2 FIX] Each work type is verified against on-chain state
;; ============================================================

;; Claim payout for a verified check-in
;; work-id = the check-in index from checkin-registry
(define-public (claim-checkin-payout (checkin-index uint))
  (let
    (
      (agent tx-sender)
      (current-epoch (get-current-epoch))
      (epoch-payouts (get-agent-epoch-payouts agent current-epoch))
      (payout-amount (get-payout-for-type WORK_TYPE_CHECKIN))
      ;; Verify the check-in exists on-chain for this agent
      (checkin-data (contract-call? .checkin-registry get-checkin agent checkin-index))
    )
    (asserts! (not (var-get paused)) ERR_PAUSED)
    (asserts! (> payout-amount u0) ERR_INVALID_AMOUNT)
    (asserts! (< epoch-payouts MAX_PAYOUTS_PER_EPOCH) ERR_RATE_LIMITED)
    ;; [C2 FIX] Verify check-in actually exists for this agent
    (asserts! (is-some checkin-data) ERR_WORK_NOT_VERIFIED)
    ;; Prevent double-claims
    (asserts!
      (map-insert WorkClaims { agent: agent, work-type: WORK_TYPE_CHECKIN, work-id: checkin-index } true)
      ERR_ALREADY_CLAIMED
    )
    ;; Update counters and pay
    (map-set AgentEpochPayouts { agent: agent, epoch: current-epoch } (+ epoch-payouts u1))
    (var-set total-paid (+ (var-get total-paid) payout-amount))
    (var-set total-payouts (+ (var-get total-payouts) u1))
    ;; [M2 FIX] Hardcoded sBTC - no ft trait parameter
    (try! (contract-call? .dao-treasury withdraw-ft .mock-sbtc payout-amount agent))
    (print {
      notification: "auto-micro-payout/claim-checkin",
      payload: { agent: agent, checkin-index: checkin-index, amount: payout-amount, epoch: current-epoch }
    })
    (ok payout-amount)
  )
)

;; Claim payout for a verified proof submission
;; work-id = the proof index from proof-registry
(define-public (claim-proof-payout (proof-index uint))
  (let
    (
      (agent tx-sender)
      (current-epoch (get-current-epoch))
      (epoch-payouts (get-agent-epoch-payouts agent current-epoch))
      (payout-amount (get-payout-for-type WORK_TYPE_PROOF))
      ;; Verify the proof exists on-chain for this agent
      (proof-data (contract-call? .proof-registry get-proof agent proof-index))
    )
    (asserts! (not (var-get paused)) ERR_PAUSED)
    (asserts! (> payout-amount u0) ERR_INVALID_AMOUNT)
    (asserts! (< epoch-payouts MAX_PAYOUTS_PER_EPOCH) ERR_RATE_LIMITED)
    ;; [C2 FIX] Verify proof actually exists for this agent
    (asserts! (is-some proof-data) ERR_WORK_NOT_VERIFIED)
    ;; Prevent double-claims
    (asserts!
      (map-insert WorkClaims { agent: agent, work-type: WORK_TYPE_PROOF, work-id: proof-index } true)
      ERR_ALREADY_CLAIMED
    )
    ;; Update counters and pay
    (map-set AgentEpochPayouts { agent: agent, epoch: current-epoch } (+ epoch-payouts u1))
    (var-set total-paid (+ (var-get total-paid) payout-amount))
    (var-set total-payouts (+ (var-get total-payouts) u1))
    (try! (contract-call? .dao-treasury withdraw-ft .mock-sbtc payout-amount agent))
    (print {
      notification: "auto-micro-payout/claim-proof",
      payload: { agent: agent, proof-index: proof-index, amount: payout-amount, epoch: current-epoch }
    })
    (ok payout-amount)
  )
)

;; Claim payout for guardian-approved work (x402, inscriptions, signals, bounties)
;; Guardian must have called approve-work first
(define-public (claim-approved-payout (work-id uint))
  (let
    (
      (agent tx-sender)
      (current-epoch (get-current-epoch))
      (epoch-payouts (get-agent-epoch-payouts agent current-epoch))
      ;; Verify guardian approval exists
      (approval (unwrap! (map-get? ApprovedWork { agent: agent, work-id: work-id }) ERR_WORK_NOT_VERIFIED))
      (payout-amount (get amount approval))
    )
    (asserts! (not (var-get paused)) ERR_PAUSED)
    (asserts! (< epoch-payouts MAX_PAYOUTS_PER_EPOCH) ERR_RATE_LIMITED)
    ;; Prevent double-claims
    (asserts!
      (map-insert WorkClaims { agent: agent, work-type: WORK_TYPE_GUARDIAN_APPROVED, work-id: work-id } true)
      ERR_ALREADY_CLAIMED
    )
    ;; Update counters and pay
    (map-set AgentEpochPayouts { agent: agent, epoch: current-epoch } (+ epoch-payouts u1))
    (var-set total-paid (+ (var-get total-paid) payout-amount))
    (var-set total-payouts (+ (var-get total-payouts) u1))
    (try! (contract-call? .dao-treasury withdraw-ft .mock-sbtc payout-amount agent))
    (print {
      notification: "auto-micro-payout/claim-approved",
      payload: { agent: agent, work-id: work-id, amount: payout-amount,
                 approved-by: (get approved-by approval), epoch: current-epoch }
    })
    (ok payout-amount)
  )
)

;; ============================================================
;; DAO GOVERNANCE
;; ============================================================

(define-public (set-paused (is-paused bool))
  (begin
    (try! (is-dao-or-extension))
    (var-set paused is-paused)
    (ok true)
  )
)

;; ============================================================
;; READ-ONLY FUNCTIONS
;; ============================================================

(define-read-only (get-current-epoch)
  (/ stacks-block-height EPOCH_LENGTH)
)

(define-read-only (get-agent-epoch-payouts (agent principal) (epoch uint))
  (default-to u0 (map-get? AgentEpochPayouts { agent: agent, epoch: epoch }))
)

(define-read-only (get-payout-for-type (work-type uint))
  (default-to u0 (map-get? PayoutAmounts work-type))
)

(define-read-only (has-claimed (agent principal) (work-type uint) (work-id uint))
  (is-some (map-get? WorkClaims { agent: agent, work-type: work-type, work-id: work-id }))
)

(define-read-only (get-approved-work (agent principal) (work-id uint))
  (map-get? ApprovedWork { agent: agent, work-id: work-id })
)

(define-read-only (get-stats)
  {
    total-paid: (var-get total-paid),
    total-payouts: (var-get total-payouts),
    paused: (var-get paused),
    current-epoch: (get-current-epoch)
  }
)

(define-read-only (get-remaining-payouts (agent principal))
  (let ((used (get-agent-epoch-payouts agent (get-current-epoch))))
    (if (>= used MAX_PAYOUTS_PER_EPOCH)
      u0
      (- MAX_PAYOUTS_PER_EPOCH used)
    )
  )
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
