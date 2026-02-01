;; title: dao-charter
;; version: 1.0.0
;; summary: An extension that manages the DAO charter, recording mission and values on-chain.

;; TRAITS
(impl-trait .dao-traits.extension)
(impl-trait .dao-traits.dao-charter)

;; CONSTANTS

;; Contract details
(define-constant DEPLOYED_BURN_BLOCK burn-block-height)
(define-constant DEPLOYED_STACKS_BLOCK stacks-block-height)
(define-constant SELF (as-contract tx-sender))

;; Error codes
(define-constant ERR_NOT_DAO_OR_EXTENSION (err u1400))
(define-constant ERR_SAVING_CHARTER (err u1401))
(define-constant ERR_CHARTER_TOO_SHORT (err u1402))
(define-constant ERR_CHARTER_TOO_LONG (err u1403))

;; DATA VARS

;; Current charter version index
(define-data-var current-charter-index uint u0)

;; DATA MAPS

;; Store charter versions with metadata
(define-map Charters
  uint ;; version number
  {
    burnHeight: uint,
    createdAt: uint,
    caller: principal,
    sender: principal,
    charter: (string-utf8 16384)
  }
)

;; PUBLIC FUNCTIONS

;; Extension callback - required by extension trait
(define-public (callback (sender principal) (memo (buff 34)))
  (ok true)
)

;; Set a new DAO charter (DAO/extension only)
(define-public (set-dao-charter (charter (string-utf8 16384)))
  (let
    (
      (new-version (+ (var-get current-charter-index) u1))
      (previous-charter (match (map-get? Charters (var-get current-charter-index))
        cv (get charter cv)
        u""
      ))
    )
    ;; Check if sender is DAO or extension
    (try! (is-dao-or-extension))
    ;; Validate charter length
    (asserts! (>= (len charter) u1) ERR_CHARTER_TOO_SHORT)
    (asserts! (<= (len charter) u16384) ERR_CHARTER_TOO_LONG)
    ;; Insert new charter version
    (asserts!
      (map-insert Charters new-version {
        burnHeight: burn-block-height,
        createdAt: stacks-block-height,
        caller: contract-caller,
        sender: tx-sender,
        charter: charter
      })
      ERR_SAVING_CHARTER
    )
    ;; Print charter info
    (print {
      notification: "dao-charter/set-dao-charter",
      payload: {
        burnHeight: burn-block-height,
        createdAt: stacks-block-height,
        contractCaller: contract-caller,
        txSender: tx-sender,
        dao: SELF,
        charter: charter,
        previousCharter: previous-charter,
        version: new-version
      }
    })
    ;; Increment charter version
    (var-set current-charter-index new-version)
    ;; Return success
    (ok true)
  )
)

;; READ-ONLY FUNCTIONS

;; Get current charter index (none if no charter set)
(define-read-only (get-current-dao-charter-index)
  (if (> (var-get current-charter-index) u0)
    (some (var-get current-charter-index))
    none
  )
)

;; Get current charter
(define-read-only (get-current-dao-charter)
  (map-get? Charters (var-get current-charter-index))
)

;; Get charter at specific version
(define-read-only (get-dao-charter (version uint))
  (map-get? Charters version)
)

;; Get contract info
(define-read-only (get-contract-info)
  {
    self: SELF,
    deployedBurnBlock: DEPLOYED_BURN_BLOCK,
    deployedStacksBlock: DEPLOYED_STACKS_BLOCK,
    currentCharterIndex: (var-get current-charter-index)
  }
)

;; PRIVATE FUNCTIONS

;; Authorization check: is caller the DAO or an enabled extension?
(define-private (is-dao-or-extension)
  (ok (asserts!
    (or
      (is-eq tx-sender .base-dao)
      (contract-call? .base-dao is-extension contract-caller)
    )
    ERR_NOT_DAO_OR_EXTENSION
  ))
)
