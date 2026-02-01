;; title: proof-registry
;; version: 1.1.0
;; summary: A registry for storing proof hashes with block metadata and reverse lookup capability.

;; =========================================
;; CONSTANTS
;; =========================================

;; Error codes (200-299 range) - Fun numbers for AI agents!
;; 255: All bits set in a byte, maxed out - this hash slot is already taken
(define-constant ERR_HASH_ALREADY_EXISTS (err u255))
;; 203: HTTP Non-Authoritative - can't get authoritative block info
(define-constant ERR_BLOCK_INFO_UNAVAILABLE (err u203))

;; Contract deployment info
(define-constant DEPLOYED_AT_BURN_BLOCK burn-block-height)
(define-constant DEPLOYED_AT_STACKS_BLOCK stacks-block-height)

;; =========================================
;; DATA STORAGE
;; =========================================

;; Proof data: stores hash and block metadata for each proof
;; Key: { user: principal, index: uint }
(define-map Proofs
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
(define-map UserProofCount principal uint)

;; Reverse lookup: hash -> { user, index }
;; Enables finding who submitted a specific proof
(define-map HashLookup (buff 32) { user: principal, index: uint })

;; =========================================
;; PUBLIC FUNCTIONS
;; =========================================

;; @desc Submit a new proof hash for tx-sender
;; @param hash - The 32-byte proof hash to register
;; @returns (response uint uint) - ok with the 0-based index of the new proof
;; @fails ERR_HASH_ALREADY_EXISTS (u255) - if this hash was previously submitted by any user
;; @fails ERR_BLOCK_INFO_UNAVAILABLE (u203) - if block metadata cannot be retrieved
;; @note Each hash can only be submitted once globally (enforced via HashLookup)
;; @note Uses previous block for id-header-hash and timestamp since current block info
;;       is not available until the block is committed
;; @note tx-sender is used intentionally so cross-contract calls record the original user
(define-public (submit-proof (hash (buff 32)))
  (let
    (
      (user tx-sender)
      (current-count (default-to u0 (map-get? UserProofCount user)))
      (prev-block (- stacks-block-height u1))
      ;; Safely retrieve block info with proper error handling
      (id-hash (unwrap! (get-stacks-block-info? id-header-hash prev-block) ERR_BLOCK_INFO_UNAVAILABLE))
      (block-time (unwrap! (get-stacks-block-info? time prev-block) ERR_BLOCK_INFO_UNAVAILABLE))
    )
    ;; Check if hash already exists
    (asserts! (is-none (map-get? HashLookup hash)) ERR_HASH_ALREADY_EXISTS)
    (let
      (
        (proof-data {
          hash: hash,
          stacks-block-height: stacks-block-height,
          burn-block-height: burn-block-height,
          id-header-hash: id-hash,
          timestamp: block-time
        })
      )
      ;; Store the proof data
      (map-set Proofs { user: user, index: current-count } proof-data)
      ;; Store the reverse lookup
      (map-set HashLookup hash { user: user, index: current-count })
      ;; Increment the user's counter
      (map-set UserProofCount user (+ current-count u1))
      ;; Emit print event for indexability
      (print {
        notification: "proof-registry/submit-proof",
        payload: {
          user: user,
          index: current-count,
          hash: hash,
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

;; @desc Get a specific proof by user and index
;; @param user - The principal who submitted the proof
;; @param index - The 0-based index of the proof
;; @returns (optional {...}) - The proof data or none if not found
(define-read-only (get-proof (user principal) (index uint))
  (map-get? Proofs { user: user, index: index })
)

;; @desc Get the total number of proofs for a user
;; @param user - The principal to query
;; @returns uint - The count of proofs (0 if user has no proofs)
(define-read-only (get-user-proof-count (user principal))
  (default-to u0 (map-get? UserProofCount user))
)

;; @desc Get the most recent proof for a user
;; @param user - The principal to query
;; @returns (optional {...}) - The latest proof data or none if user has no proofs
(define-read-only (get-last-proof (user principal))
  (let
    (
      (count (get-user-proof-count user))
    )
    (if (is-eq count u0)
      none
      (map-get? Proofs { user: user, index: (- count u1) })
    )
  )
)

;; @desc Reverse lookup: find who submitted a hash and at what index
;; @param hash - The 32-byte hash to look up
;; @returns (optional { user, index }) - The submitter info or none if hash not found
(define-read-only (lookup-proof-by-hash (hash (buff 32)))
  (map-get? HashLookup hash)
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
