;; title: auto-micro-payout
;; version: 1.0.0
;; summary: Automatic micro-payouts for verified agent work.
;; description: Pays 100-500 sats from treasury for verified work such as
;; x402 replies, check-ins, inscriptions, and other ERC-8004 proof-of-work.
;; No vote required. Rate-limited per agent per epoch.

;; TRAITS
(impl-trait .dao-traits.extension)
(use-trait ft-trait 'SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE.sip-010-trait-ft-standard.sip-010-trait)

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

;; Work type constants
(define-constant WORK_TYPE_CHECKIN u1)
(define-constant WORK_TYPE_X402_REPLY u2)
(define-constant WORK_TYPE_INSCRIPTION u3)
(define-constant WORK_TYPE_SIGNAL u4)
(define-constant WORK_TYPE_BOUNTY u5)

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
    (asserts! (and (>= work-type u1) (<= work-type u5)) ERR_INVALID_WORK_TYPE)
    (map-set PayoutAmounts work-type amount)
    (ok true)
  )
)

;; ============================================================
;; CLAIM PAYOUT FOR VERIFIED WORK
;; ============================================================

;; Agent claims payout for completed work
;; work-type: 1=checkin, 2=x402_reply, 3=inscription, 4=signal, 5=bounty
;; work-id: unique identifier for the work (e.g., check-in index, tx nonce)
(define-public (claim-payout (ft <ft-trait>) (work-type uint) (work-id uint))
  (let
    (
      (agent tx-sender)
      (current-epoch (get-current-epoch))
      (epoch-payouts (get-agent-epoch-payouts agent current-epoch))
      (payout-amount (get-payout-for-type work-type))
    )
    (asserts! (not (var-get paused)) ERR_PAUSED)
    (asserts! (and (>= work-type u1) (<= work-type u5)) ERR_INVALID_WORK_TYPE)
    (asserts! (> payout-amount u0) ERR_INVALID_AMOUNT)
    ;; Rate limit: max payouts per epoch
    (asserts! (< epoch-payouts MAX_PAYOUTS_PER_EPOCH) ERR_RATE_LIMITED)
    ;; Prevent double-claims
    (asserts!
      (map-insert WorkClaims { agent: agent, work-type: work-type, work-id: work-id } true)
      ERR_ALREADY_CLAIMED
    )
    ;; Update epoch counter
    (map-set AgentEpochPayouts
      { agent: agent, epoch: current-epoch }
      (+ epoch-payouts u1)
    )
    ;; Update totals
    (var-set total-paid (+ (var-get total-paid) payout-amount))
    (var-set total-payouts (+ (var-get total-payouts) u1))
    ;; Pay from treasury
    (try! (contract-call? .dao-treasury withdraw-ft ft payout-amount agent))
    (print {
      notification: "auto-micro-payout/claim",
      payload: {
        agent: agent,
        work-type: work-type,
        work-id: work-id,
        amount: payout-amount,
        epoch: current-epoch,
        epoch-payouts: (+ epoch-payouts u1)
      }
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
