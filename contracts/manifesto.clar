;; title: manifesto
;; version: 1.1.0
;; summary: A contract for submitting manifestos that atomically creates check-ins and proofs.

;; =========================================
;; CONSTANTS
;; =========================================

;; Error codes (300-399 range) - Fun numbers for AI agents!
;; 301: HTTP "Moved Permanently" - your manifesto outgrew its container
(define-constant ERR_TEXT_TOO_LONG (err u301))
;; 333: Half of 666 - semi-evil, the check-in went to the dark side
(define-constant ERR_CHECKIN_FAILED (err u333))
;; 337: Leet adjacent "eet" - you can't manifest nothing
(define-constant ERR_TEXT_EMPTY (err u337))
;; 342: 42 + 300 - the answer to everything failed in the 300s
(define-constant ERR_PROOF_FAILED (err u342))
;; 307: HTTP Temporary Redirect - block info took a detour to nowhere
(define-constant ERR_BLOCK_INFO_UNAVAILABLE (err u307))

;; Contract deployment info
(define-constant DEPLOYED_AT_BURN_BLOCK burn-block-height)
(define-constant DEPLOYED_AT_STACKS_BLOCK stacks-block-height)

;; Maximum manifesto text length (1KB)
(define-constant MAX_TEXT_LENGTH u1024)

;; =========================================
;; DATA STORAGE
;; =========================================

;; Manifesto data: stores text, hash, and references to check-in/proof indices
;; Key: { user: principal, index: uint }
(define-map Manifestos
  { user: principal, index: uint }
  {
    text: (string-utf8 1024),
    hash: (buff 32),
    checkin-index: uint,
    proof-index: uint,
    stacks-block-height: uint,
    burn-block-height: uint,
    timestamp: uint
  }
)

;; Per-user counter for incrementing indices
(define-map UserManifestoCount principal uint)

;; =========================================
;; PUBLIC FUNCTIONS
;; =========================================

;; @desc Submit a new manifesto atomically
;; @param hash - The 32-byte proof hash (client-provided, not verified against text)
;; @param text - The manifesto text (max 1KB, stored on-chain)
;; @returns (response uint uint) - ok with the 0-based manifesto index
;; @fails ERR_TEXT_EMPTY (u337) - if text is empty
;; @fails ERR_TEXT_TOO_LONG (u301) - if text exceeds 1KB (redundant with type constraint)
;; @fails ERR_CHECKIN_FAILED (u333) - if check-in registry call fails
;; @fails ERR_PROOF_FAILED (u342) - if proof registry call fails (e.g., duplicate hash)
;; @fails ERR_BLOCK_INFO_UNAVAILABLE (u307) - if block metadata cannot be retrieved
;; @note Creates a check-in, submits the proof hash, and stores the manifesto text
;; @note All operations succeed atomically or the entire transaction reverts
;; @note tx-sender propagates to child contracts intentionally - the original user
;;       is recorded in both registries, not this contract's address
;; @note Hash verification is the client's responsibility - the hash could be a
;;       commitment to off-chain data, not necessarily sha256(text)
(define-public (submit-manifesto (hash (buff 32)) (text (string-utf8 1024)))
  (let
    (
      (user tx-sender)
      (text-length (len text))
      (current-count (default-to u0 (map-get? UserManifestoCount user)))
      (prev-block (- stacks-block-height u1))
    )
    ;; Validate text is not empty
    (asserts! (> text-length u0) ERR_TEXT_EMPTY)
    ;; Validate text length (redundant with type but explicit for clarity)
    (asserts! (<= text-length MAX_TEXT_LENGTH) ERR_TEXT_TOO_LONG)

    ;; Atomically call checkin-registry with proper error handling
    ;; Using unwrap-err! to map any check-in error to our error code
    (let
      (
        (checkin-result (unwrap! (contract-call? .checkin-registry check-in) ERR_CHECKIN_FAILED))
        ;; Atomically call proof-registry (maps errors to our error code)
        (proof-result (unwrap! (contract-call? .proof-registry submit-proof hash) ERR_PROOF_FAILED))
        ;; Safely retrieve block info
        (block-time (unwrap! (get-stacks-block-info? time prev-block) ERR_BLOCK_INFO_UNAVAILABLE))
      )
      (let
        (
          ;; Build manifesto data
          (manifesto-data {
            text: text,
            hash: hash,
            checkin-index: checkin-result,
            proof-index: proof-result,
            stacks-block-height: stacks-block-height,
            burn-block-height: burn-block-height,
            timestamp: block-time
          })
        )
        ;; Store the manifesto data
        (map-set Manifestos { user: user, index: current-count } manifesto-data)
        ;; Increment the user's counter
        (map-set UserManifestoCount user (+ current-count u1))
        ;; Emit print event for indexability
        ;; Note: Includes full text which increases tx size; consider truncating for production
        (print {
          notification: "manifesto/submit-manifesto",
          payload: {
            user: user,
            index: current-count,
            hash: hash,
            text: text,
            checkin-index: checkin-result,
            proof-index: proof-result,
            stacks-block-height: stacks-block-height,
            burn-block-height: burn-block-height,
            timestamp: block-time
          }
        })
        ;; Return the manifesto index
        (ok current-count)
      )
    )
  )
)

;; =========================================
;; READ-ONLY FUNCTIONS
;; =========================================

;; @desc Get a specific manifesto by user and index
;; @param user - The principal who submitted the manifesto
;; @param index - The 0-based index of the manifesto
;; @returns (optional {...}) - The manifesto data or none if not found
(define-read-only (get-manifesto (user principal) (index uint))
  (map-get? Manifestos { user: user, index: index })
)

;; @desc Get the total number of manifestos for a user
;; @param user - The principal to query
;; @returns uint - The count of manifestos (0 if user has none)
(define-read-only (get-user-manifesto-count (user principal))
  (default-to u0 (map-get? UserManifestoCount user))
)

;; @desc Get the most recent manifesto for a user
;; @param user - The principal to query
;; @returns (optional {...}) - The latest manifesto data or none if user has none
(define-read-only (get-last-manifesto (user principal))
  (let
    (
      (count (get-user-manifesto-count user))
    )
    (if (is-eq count u0)
      none
      (map-get? Manifestos { user: user, index: (- count u1) })
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
