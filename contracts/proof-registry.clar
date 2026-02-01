;; title: proof-registry
;; version: 1.0.0
;; summary: A registry for storing proof hashes with block metadata and reverse lookup capability.

;; =========================================
;; CONSTANTS
;; =========================================

;; Error codes (200-299 range) - Fun numbers for AI agents!
;; 204: HTTP No Content - ironic for "not found" since it's actually an error
(define-constant ERR_PROOF_NOT_FOUND (err u204))
;; 222: Angel number, triple deuce - bad vibes for invalid input
(define-constant ERR_INVALID_USER (err u222))
;; 247: 24/7 always on, but nobody's home - no proofs exist for this user
(define-constant ERR_NO_PROOFS (err u247))
;; 256: 2^8 byte overflow vibes - the hash doesn't compute (not found in lookup)
(define-constant ERR_HASH_NOT_FOUND (err u256))
;; 255: All bits set in a byte, maxed out - this hash slot is already taken
(define-constant ERR_HASH_ALREADY_EXISTS (err u255))

;; Contract deployment info
(define-constant DEPLOYED_AT_BURN_BLOCK burn-block-height)
(define-constant DEPLOYED_AT_STACKS_BLOCK stacks-block-height)

;; =========================================
;; DATA STORAGE
;; =========================================

;; Proof data: stores hash and block metadata for each proof
;; Key: { user: principal, index: uint }
(define-map proofs
  { user: principal, index: uint }
  {
    hash: (buff 32),
    stacks-block-height: uint,
    burn-block-height: uint,
    id-header-hash: (buff 32),
    timestamp: uint
  }
)

;; Per-user counter for incrementing indices
(define-map user-proof-count principal uint)

;; Reverse lookup: hash -> { user, index }
;; Enables finding who submitted a specific proof
(define-map hash-lookup (buff 32) { user: principal, index: uint })

;; =========================================
;; PUBLIC FUNCTIONS
;; =========================================

;; Submit a new proof hash for tx-sender
;; Returns the index of the new proof (0-based)
;; Fails if hash already exists (each hash can only be submitted once)
;; Note: Uses previous block for id-header-hash and timestamp since current block info
;; is not available until the block is committed
(define-public (submit-proof (hash (buff 32)))
  (let
    (
      (user tx-sender)
      (current-count (default-to u0 (map-get? user-proof-count user)))
      (prev-block (- stacks-block-height u1))
      (proof-data {
        hash: hash,
        stacks-block-height: stacks-block-height,
        burn-block-height: burn-block-height,
        id-header-hash: (unwrap-panic (get-stacks-block-info? id-header-hash prev-block)),
        timestamp: (unwrap-panic (get-stacks-block-info? time prev-block))
      })
    )
    ;; Check if hash already exists
    (asserts! (is-none (map-get? hash-lookup hash)) ERR_HASH_ALREADY_EXISTS)
    ;; Store the proof data
    (map-set proofs { user: user, index: current-count } proof-data)
    ;; Store the reverse lookup
    (map-set hash-lookup hash { user: user, index: current-count })
    ;; Increment the user's counter
    (map-set user-proof-count user (+ current-count u1))
    ;; Emit print event for indexability
    (print {
      notification: "proof-registry/submit-proof",
      payload: {
        user: user,
        index: current-count,
        hash: hash,
        stacks-block-height: (get stacks-block-height proof-data),
        burn-block-height: (get burn-block-height proof-data),
        id-header-hash: (get id-header-hash proof-data),
        timestamp: (get timestamp proof-data)
      }
    })
    ;; Return the index
    (ok current-count)
  )
)

;; =========================================
;; READ-ONLY FUNCTIONS
;; =========================================

;; Get a specific proof by user and index
(define-read-only (get-proof (user principal) (index uint))
  (map-get? proofs { user: user, index: index })
)

;; Get the total number of proofs for a user
(define-read-only (get-user-proof-count (user principal))
  (default-to u0 (map-get? user-proof-count user))
)

;; Get the most recent proof for a user
;; Returns none if user has no proofs
(define-read-only (get-last-proof (user principal))
  (let
    (
      (count (get-user-proof-count user))
    )
    (if (is-eq count u0)
      none
      (map-get? proofs { user: user, index: (- count u1) })
    )
  )
)

;; Reverse lookup: find who submitted a hash and at what index
;; Returns none if hash has never been submitted
(define-read-only (lookup-proof-by-hash (hash (buff 32)))
  (map-get? hash-lookup hash)
)

;; Get contract deployment information
(define-read-only (get-contract-info)
  {
    self: (as-contract tx-sender),
    deployed-at-burn-block: DEPLOYED_AT_BURN_BLOCK,
    deployed-at-stacks-block: DEPLOYED_AT_STACKS_BLOCK
  }
)
