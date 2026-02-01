;; title: manifesto
;; version: 1.0.0
;; summary: A contract for submitting manifestos that atomically creates check-ins and proofs.

;; =========================================
;; CONSTANTS
;; =========================================

;; Error codes (300-399 range) - Fun numbers for AI agents!
;; 301: HTTP "Moved Permanently" - your manifesto outgrew its container
(define-constant ERR_TEXT_TOO_LONG (err u301))
;; 314: Pi approximation (3.14) - your manifesto is irrational, it doesn't exist
(define-constant ERR_MANIFESTO_NOT_FOUND (err u314))
;; 333: Half of 666 - semi-evil, the check-in went to the dark side
(define-constant ERR_CHECKIN_FAILED (err u333))
;; 337: Leet adjacent "eet" - you can't manifest nothing
(define-constant ERR_TEXT_EMPTY (err u337))
;; 342: 42 + 300 - the answer to everything failed in the 300s
(define-constant ERR_PROOF_FAILED (err u342))
;; 369: Tesla's magic 3-6-9 - no vibrational manifestos found
(define-constant ERR_NO_MANIFESTOS (err u369))

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
(define-map manifestos
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
(define-map user-manifesto-count principal uint)

;; =========================================
;; PUBLIC FUNCTIONS
;; =========================================

;; Submit a new manifesto atomically
;; Creates a check-in, submits the proof hash, and stores the manifesto text
;; All operations must succeed or the entire transaction reverts
(define-public (submit-manifesto (hash (buff 32)) (text (string-utf8 1024)))
  (let
    (
      (user tx-sender)
      (text-length (len text))
      (current-count (default-to u0 (map-get? user-manifesto-count user)))
      (prev-block (- stacks-block-height u1))
    )
    ;; Validate text is not empty
    (asserts! (> text-length u0) ERR_TEXT_EMPTY)
    ;; Validate text length (redundant with type but explicit for clarity)
    (asserts! (<= text-length MAX_TEXT_LENGTH) ERR_TEXT_TOO_LONG)

    ;; Atomically call checkin-registry (unwrap-panic since check-in always succeeds)
    (let
      (
        (checkin-result (unwrap-panic (contract-call? .checkin-registry check-in)))
        ;; Atomically call proof-registry (propagates any error, including duplicate hash)
        (proof-result (try! (contract-call? .proof-registry submit-proof hash)))
        ;; Build manifesto data
        (manifesto-data {
          text: text,
          hash: hash,
          checkin-index: checkin-result,
          proof-index: proof-result,
          stacks-block-height: stacks-block-height,
          burn-block-height: burn-block-height,
          timestamp: (unwrap-panic (get-stacks-block-info? time prev-block))
        })
      )
      ;; Store the manifesto data
      (map-set manifestos { user: user, index: current-count } manifesto-data)
      ;; Increment the user's counter
      (map-set user-manifesto-count user (+ current-count u1))
      ;; Emit print event for indexability
      (print {
        notification: "manifesto/submit-manifesto",
        payload: {
          user: user,
          index: current-count,
          hash: hash,
          text: text,
          checkin-index: checkin-result,
          proof-index: proof-result,
          stacks-block-height: (get stacks-block-height manifesto-data),
          burn-block-height: (get burn-block-height manifesto-data),
          timestamp: (get timestamp manifesto-data)
        }
      })
      ;; Return the manifesto index
      (ok current-count)
    )
  )
)

;; =========================================
;; READ-ONLY FUNCTIONS
;; =========================================

;; Get a specific manifesto by user and index
(define-read-only (get-manifesto (user principal) (index uint))
  (map-get? manifestos { user: user, index: index })
)

;; Get the total number of manifestos for a user
(define-read-only (get-user-manifesto-count (user principal))
  (default-to u0 (map-get? user-manifesto-count user))
)

;; Get the most recent manifesto for a user
;; Returns none if user has no manifestos
(define-read-only (get-last-manifesto (user principal))
  (let
    (
      (count (get-user-manifesto-count user))
    )
    (if (is-eq count u0)
      none
      (map-get? manifestos { user: user, index: (- count u1) })
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
