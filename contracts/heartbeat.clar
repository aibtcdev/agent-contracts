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

;; =========================================
;; DATA STORAGE
;; =========================================

;; Last Stacks block height at which the agent was seen
(define-map last-seen principal uint)

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
    ;; Prevent contracts from recording activity for themselves
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
        block: stacks-block-height
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
    block (< (- stacks-block-height block) threshold)
    false
  )
)

;; @desc Get the last block height at which an agent was seen.
;; @param agent - The principal to query
;; @returns (optional uint) - block height or none if never seen
(define-read-only (get-last-seen (agent principal))
  (map-get? last-seen agent)
)

;; @desc Get the number of blocks since an agent was last seen.
;; @param agent - The principal to query
;; @returns (optional uint) - blocks elapsed or none if never seen
(define-read-only (get-blocks-since (agent principal))
  (match (map-get? last-seen agent)
    block (some (- stacks-block-height block))
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
(define-private (record-activity (agent principal))
  (begin
    (if (is-none (map-get? last-seen agent))
      (var-set total-agents (+ (var-get total-agents) u1))
      false
    )
    (map-set last-seen agent stacks-block-height)
  )
)
