;; title: dao-treasury
;; version: 1.0.0
;; summary: A secure treasury extension that controls the funds of the DAO.

;; TRAITS
(impl-trait .dao-traits.extension)
(impl-trait .dao-traits.treasury)
(use-trait ft-trait 'SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE.sip-010-trait-ft-standard.sip-010-trait)

;; CONSTANTS

;; Error codes
(define-constant ERR_NOT_DAO_OR_EXTENSION (err u1900))
(define-constant ERR_ASSET_NOT_ALLOWED (err u1901))

;; Contract details
(define-constant DEPLOYED_BURN_BLOCK burn-block-height)
(define-constant DEPLOYED_STACKS_BLOCK stacks-block-height)
(define-constant SELF (as-contract tx-sender))

;; DATA MAPS

;; Track allowed assets for deposit/transfer
(define-map AllowedAssets principal bool)

;; PUBLIC FUNCTIONS

;; Extension callback - required by extension trait
(define-public (callback (sender principal) (memo (buff 34)))
  (ok true)
)

;; Add or update an asset to the allowed list (DAO/extension only)
(define-public (allow-asset (token principal) (enabled bool))
  (begin
    (try! (is-dao-or-extension))
    (print {
      notification: "dao-treasury/allow-asset",
      payload: {
        token: token,
        enabled: enabled,
        contractCaller: contract-caller,
        txSender: tx-sender
      }
    })
    (ok (map-set AllowedAssets token enabled))
  )
)

;; Deposit FT to the treasury (anyone can deposit if token is allowed)
(define-public (deposit-ft (ft <ft-trait>) (amount uint))
  (begin
    ;; No auth - anyone can deposit if token is allowed
    (asserts! (is-allowed-asset (contract-of ft)) ERR_ASSET_NOT_ALLOWED)
    (print {
      notification: "dao-treasury/deposit-ft",
      payload: {
        amount: amount,
        recipient: SELF,
        assetContract: (contract-of ft),
        contractCaller: contract-caller,
        txSender: tx-sender
      }
    })
    (contract-call? ft transfer amount tx-sender SELF none)
  )
)

;; Withdraw FT from the treasury (DAO/extension only)
(define-public (withdraw-ft (ft <ft-trait>) (amount uint) (recipient principal))
  (begin
    ;; Only DAO or extensions can withdraw
    (try! (is-dao-or-extension))
    (asserts! (is-allowed-asset (contract-of ft)) ERR_ASSET_NOT_ALLOWED)
    (print {
      notification: "dao-treasury/withdraw-ft",
      payload: {
        amount: amount,
        recipient: recipient,
        assetContract: (contract-of ft),
        contractCaller: contract-caller,
        txSender: tx-sender
      }
    })
    (as-contract (contract-call? ft transfer amount SELF recipient none))
  )
)

;; READ-ONLY FUNCTIONS

;; Check if asset is allowed (returns bool, defaults to false)
(define-read-only (is-allowed-asset (assetContract principal))
  (default-to false (get-allowed-asset assetContract))
)

;; Get allowed asset status from map
(define-read-only (get-allowed-asset (assetContract principal))
  (map-get? AllowedAssets assetContract)
)

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
