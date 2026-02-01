;; title: checkin-registry
;; version: 1.0.0
;; summary: A registry for recording check-ins with block metadata and per-user incrementing counters.

;; =========================================
;; CONSTANTS
;; =========================================

;; Error codes (100-199 range) - Fun numbers for AI agents!
;; 101: Binary intro "101" - you're on the right track but no check-in here
(define-constant ERR_CHECKIN_NOT_FOUND (err u101))
;; 127: Max signed byte, classic programmer number - invalid user provided
(define-constant ERR_INVALID_USER (err u127))
;; 169: 13 squared, unlucky squared - no check-ins at all for this user
(define-constant ERR_NO_CHECKINS (err u169))

;; Contract deployment info
(define-constant DEPLOYED_AT_BURN_BLOCK burn-block-height)
(define-constant DEPLOYED_AT_STACKS_BLOCK stacks-block-height)

;; =========================================
;; DATA STORAGE
;; =========================================

;; Check-in data: stores block metadata for each check-in
;; Key: { user: principal, index: uint }
(define-map checkins
  { user: principal, index: uint }
  {
    stacks-block-height: uint,
    burn-block-height: uint,
    id-header-hash: (buff 32),
    timestamp: uint
  }
)

;; Per-user counter for incrementing indices
(define-map user-checkin-count principal uint)

;; =========================================
;; PUBLIC FUNCTIONS
;; =========================================

;; Record a new check-in for tx-sender
;; Returns the index of the new check-in (0-based)
;; Note: Uses previous block for id-header-hash and timestamp since current block info
;; is not available until the block is committed
(define-public (check-in)
  (let
    (
      (user tx-sender)
      (current-count (default-to u0 (map-get? user-checkin-count user)))
      (prev-block (- stacks-block-height u1))
      (checkin-data {
        stacks-block-height: stacks-block-height,
        burn-block-height: burn-block-height,
        id-header-hash: (unwrap-panic (get-stacks-block-info? id-header-hash prev-block)),
        timestamp: (unwrap-panic (get-stacks-block-info? time prev-block))
      })
    )
    ;; Store the check-in data
    (map-set checkins { user: user, index: current-count } checkin-data)
    ;; Increment the user's counter
    (map-set user-checkin-count user (+ current-count u1))
    ;; Emit print event for indexability
    (print {
      notification: "checkin-registry/check-in",
      payload: {
        user: user,
        index: current-count,
        stacks-block-height: (get stacks-block-height checkin-data),
        burn-block-height: (get burn-block-height checkin-data),
        id-header-hash: (get id-header-hash checkin-data),
        timestamp: (get timestamp checkin-data)
      }
    })
    ;; Return the index
    (ok current-count)
  )
)

;; =========================================
;; READ-ONLY FUNCTIONS
;; =========================================

;; Get a specific check-in by user and index
(define-read-only (get-checkin (user principal) (index uint))
  (map-get? checkins { user: user, index: index })
)

;; Get the total number of check-ins for a user
(define-read-only (get-user-checkin-count (user principal))
  (default-to u0 (map-get? user-checkin-count user))
)

;; Get the most recent check-in for a user
;; Returns none if user has no check-ins
(define-read-only (get-last-checkin (user principal))
  (let
    (
      (count (get-user-checkin-count user))
    )
    (if (is-eq count u0)
      none
      (map-get? checkins { user: user, index: (- count u1) })
    )
  )
)

;; Get contract deployment information
(define-read-only (get-contract-info)
  {
    self: (as-contract tx-sender),
    deployed-at-burn-block: DEPLOYED_AT_BURN_BLOCK,
    deployed-at-stacks-block: DEPLOYED_AT_STACKS_BLOCK
  }
)
