;; title: dao-token-owner
;; version: 1.0.0
;; summary: An extension that provides management functions for the DAO token.

;; TRAITS
(impl-trait .dao-traits.extension)
(impl-trait .dao-traits.token-owner)

;; CONSTANTS

;; Error codes
(define-constant ERR_NOT_DAO_OR_EXTENSION (err u1800))

;; Contract details
(define-constant DEPLOYED_BURN_BLOCK burn-block-height)
(define-constant DEPLOYED_STACKS_BLOCK stacks-block-height)
(define-constant SELF (as-contract tx-sender))

;; PUBLIC FUNCTIONS

;; Extension callback - required by extension trait
(define-public (callback (sender principal) (memo (buff 34)))
  (ok true)
)

;; Set the token URI (DAO/extension only)
(define-public (set-token-uri (value (string-utf8 256)))
  (begin
    ;; Check if caller is authorized
    (try! (is-dao-or-extension))
    ;; Update token URI via the token contract
    (try! (as-contract (contract-call? .dao-token set-token-uri value)))
    ;; Print event
    (print {
      notification: "dao-token-owner/set-token-uri",
      payload: {
        contractCaller: contract-caller,
        txSender: tx-sender,
        value: value
      }
    })
    (ok true)
  )
)

;; Transfer token ownership (DAO/extension only)
(define-public (transfer-ownership (new-owner principal))
  (begin
    ;; Check if caller is authorized
    (try! (is-dao-or-extension))
    ;; Transfer ownership via the token contract
    (try! (as-contract (contract-call? .dao-token transfer-ownership new-owner)))
    ;; Print event
    (print {
      notification: "dao-token-owner/transfer-ownership",
      payload: {
        contractCaller: contract-caller,
        txSender: tx-sender,
        newOwner: new-owner
      }
    })
    (ok true)
  )
)

;; READ-ONLY FUNCTIONS

;; Get contract info
(define-read-only (get-contract-info)
  {
    self: SELF,
    deployedBurnBlock: DEPLOYED_BURN_BLOCK,
    deployedStacksBlock: DEPLOYED_STACKS_BLOCK
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
