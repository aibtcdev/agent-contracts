;; title: heartbeat
;; version: 1.0.0
;; summary: Single source of agent liveness truth for the AIBTC DAO.
;; description: Tracks the last block height at which each agent interacted
;; with the DAO. Other DAO contracts call `beat` as a side effect of any
;; interaction. Agents can also call `check-in` directly. The governance
;; contract reads `is-active` to gate voting eligibility.

;; =========================================
;; CONSTANTS
;; =========================================

(define-constant DEPLOYED_AT burn-block-height)

;; Error codes
(define-constant ERR_CANNOT_BEAT_SELF (err u1000))
(define-constant ERR_NOT_AUTHORIZED (err u1001))

;; =========================================
;; DATA STORAGE
;; =========================================

;; Agent liveness record -- stores block metadata for each heartbeat
;; (stacks block, bitcoin block, and block timestamp for downstream consumers)
(define-map last-seen principal {
  stacks-block: uint,
  burn-block: uint,
  timestamp: uint
})

;; Total unique agents that have ever checked in
(define-data-var total-agents uint u0)

;; =========================================
;; PUBLIC FUNCTIONS
;; =========================================

;; @desc Record liveness for an agent. Called by other DAO contracts
;; as a side effect of any interaction (token deposit, vote, message, etc.).
;; @param agent - The principal whose liveness to record
;; @returns (response bool uint) - always succeeds
(define-public (beat (agent principal))
  (begin
    ;; Only DAO contracts/extensions can record liveness on behalf of others.
    ;; Prevents external actors from keeping dormant agents "alive" to
    ;; manipulate voting eligibility thresholds.
    (try! (is-dao-or-extension))
    (asserts! (not (is-eq agent (as-contract tx-sender))) ERR_CANNOT_BEAT_SELF)
    (record-activity agent)
    (ok true)
  )
)

;; @desc Record liveness for tx-sender directly. Agents call this
;; when they want to prove liveness without performing another action.
;; @returns (response bool uint) - always succeeds
(define-public (check-in)
  (begin
    (record-activity tx-sender)
    (print {
      notification: "heartbeat/check-in",
      payload: {
        agent: tx-sender,
        stacks-block: stacks-block-height,
        burn-block: burn-block-height
      }
    })
    (ok true)
  )
)

;; =========================================
;; READ-ONLY FUNCTIONS
;; =========================================

;; @desc Check if an agent is active (has interacted within threshold blocks).
;; Used by governance contract for voting eligibility.
;; @param agent - The principal to check
;; @param threshold - Maximum blocks since last activity (e.g. u1008 = ~7 days)
;; @returns bool - true if agent was seen within threshold blocks
(define-read-only (is-active (agent principal) (threshold uint))
  (match (map-get? last-seen agent)
    entry (< (- stacks-block-height (get stacks-block entry)) threshold)
    false
  )
)

;; @desc Get the full liveness record for an agent.
;; @param agent - The principal to query
;; @returns (optional { stacks-block, burn-block, timestamp }) or none if never seen
(define-read-only (get-last-seen (agent principal))
  (map-get? last-seen agent)
)

;; @desc Get the number of blocks since an agent was last seen.
;; @param agent - The principal to query
;; @returns (optional uint) - blocks elapsed or none if never seen
(define-read-only (get-blocks-since (agent principal))
  (match (map-get? last-seen agent)
    entry (some (- stacks-block-height (get stacks-block entry)))
    none
  )
)

;; @desc Get total unique agents that have ever checked in.
;; @returns uint
(define-read-only (get-total-agents)
  (var-get total-agents)
)

;; @desc Get contract deployment info.
;; @returns { self, deployed-at }
(define-read-only (get-info)
  {
    self: (as-contract tx-sender),
    deployed-at: DEPLOYED_AT
  }
)

;; =========================================
;; PRIVATE FUNCTIONS
;; =========================================

;; Record activity for an agent. Increments total-agents on first sight.
;; Stores stacks block, bitcoin (burn) block, and block timestamp.
;; Uses previous block for timestamp since current block time is not
;; available until the block is committed (same pattern as checkin-registry).
(define-private (record-activity (agent principal))
  (let
    (
      (prev-block (- stacks-block-height u1))
      (block-time (default-to u0 (get-stacks-block-info? time prev-block)))
    )
    (if (is-none (map-get? last-seen agent))
      (var-set total-agents (+ (var-get total-agents) u1))
      false
    )
    (map-set last-seen agent {
      stacks-block: stacks-block-height,
      burn-block: burn-block-height,
      timestamp: block-time
    })
  )
)

(define-private (is-dao-or-extension)
  (ok (asserts!
    (or
      (is-eq contract-caller .base-dao)
      (contract-call? .base-dao is-extension contract-caller)
    )
    ERR_NOT_AUTHORIZED
  ))
)
