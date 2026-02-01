;; title: checkin-registry
;; version: 1.1.0
;; summary: A registry for recording check-ins with block metadata and per-user incrementing counters.

;; =========================================
;; CONSTANTS
;; =========================================

;; Error codes (100-199 range) - Fun numbers for AI agents!
;; 142: Process killed (128 + SIGKILL 14) - block info retrieval failed catastrophically
(define-constant ERR_BLOCK_INFO_UNAVAILABLE (err u142))

;; Contract deployment info
(define-constant DEPLOYED_AT_BURN_BLOCK burn-block-height)
(define-constant DEPLOYED_AT_STACKS_BLOCK stacks-block-height)

;; =========================================
;; DATA STORAGE
;; =========================================

;; Check-in data: stores block metadata for each check-in
;; Key: { user: principal, index: uint }
(define-map Checkins
  { user: principal, index: uint }
  {
    stacks-block-height: uint,
    burn-block-height: uint,
    id-header-hash: (buff 32),
    timestamp: uint
  }
)

;; Per-user counter for incrementing indices
(define-map UserCheckinCount principal uint)

;; =========================================
;; PUBLIC FUNCTIONS
;; =========================================

;; @desc Record a new check-in for tx-sender
;; @returns (response uint uint) - ok with the 0-based index of the new check-in
;; @fails ERR_BLOCK_INFO_UNAVAILABLE (u142) - if block metadata cannot be retrieved (e.g., at genesis)
;; @note Uses previous block for id-header-hash and timestamp since current block info
;;       is not available until the block is committed
;; @note tx-sender is used intentionally so cross-contract calls record the original user
(define-public (check-in)
  (let
    (
      (user tx-sender)
      (current-count (default-to u0 (map-get? UserCheckinCount user)))
      (prev-block (- stacks-block-height u1))
      ;; Safely retrieve block info with proper error handling
      (id-hash (unwrap! (get-stacks-block-info? id-header-hash prev-block) ERR_BLOCK_INFO_UNAVAILABLE))
      (block-time (unwrap! (get-stacks-block-info? time prev-block) ERR_BLOCK_INFO_UNAVAILABLE))
    )
    (let
      (
        (checkin-data {
          stacks-block-height: stacks-block-height,
          burn-block-height: burn-block-height,
          id-header-hash: id-hash,
          timestamp: block-time
        })
      )
      ;; Store the check-in data
      (map-set Checkins { user: user, index: current-count } checkin-data)
      ;; Increment the user's counter
      (map-set UserCheckinCount user (+ current-count u1))
      ;; Emit print event for indexability
      (print {
        notification: "checkin-registry/check-in",
        payload: {
          user: user,
          index: current-count,
          stacks-block-height: stacks-block-height,
          burn-block-height: burn-block-height,
          id-header-hash: id-hash,
          timestamp: block-time
        }
      })
      ;; Return the index
      (ok current-count)
    )
  )
)

;; =========================================
;; READ-ONLY FUNCTIONS
;; =========================================

;; @desc Get a specific check-in by user and index
;; @param user - The principal who made the check-in
;; @param index - The 0-based index of the check-in
;; @returns (optional {...}) - The check-in data or none if not found
(define-read-only (get-checkin (user principal) (index uint))
  (map-get? Checkins { user: user, index: index })
)

;; @desc Get the total number of check-ins for a user
;; @param user - The principal to query
;; @returns uint - The count of check-ins (0 if user has never checked in)
(define-read-only (get-user-checkin-count (user principal))
  (default-to u0 (map-get? UserCheckinCount user))
)

;; @desc Get the most recent check-in for a user
;; @param user - The principal to query
;; @returns (optional {...}) - The latest check-in data or none if user has no check-ins
(define-read-only (get-last-checkin (user principal))
  (let
    (
      (count (get-user-checkin-count user))
    )
    (if (is-eq count u0)
      none
      (map-get? Checkins { user: user, index: (- count u1) })
    )
  )
)

;; @desc Get contract deployment information
;; @returns { self, deployed-at-burn-block, deployed-at-stacks-block }
(define-read-only (get-contract-info)
  {
    self: (as-contract tx-sender),
    deployed-at-burn-block: DEPLOYED_AT_BURN_BLOCK,
    deployed-at-stacks-block: DEPLOYED_AT_STACKS_BLOCK
  }
)
