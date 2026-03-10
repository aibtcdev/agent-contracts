;; title: auto-micro-payout
;; version: 2.0.0
;; summary: Automatic micro-payouts for verified agent work (v2 - no guardians).
;; description: Pays 100-500 sats from treasury for verified work such as
;; check-ins and proofs. Verifies work against on-chain registries before paying.
;; No vote required. Rate-limited per agent per epoch.
;; v2: Removed guardian-approved work type. Only on-chain verified work qualifies.

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

;; Work type constants (only on-chain verifiable types)
(define-constant WORK_TYPE_CHECKIN u1)
(define-constant WORK_TYPE_PROOF u2)

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
    (asserts! (and (>= work-type u1) (<= work-type u2)) ERR_INVALID_WORK_TYPE)
    (map-set PayoutAmounts work-type amount)
    (ok true)
  )
)

;; ============================================================
;; CLAIM PAYOUT FOR VERIFIED WORK
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
    ;; Verify check-in actually exists for this agent
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
    ;; Hardcoded sBTC
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
    ;; Verify proof actually exists for this agent
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
