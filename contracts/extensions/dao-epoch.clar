;; title: dao-epoch
;; version: 1.0.0
;; summary: An extension that tracks the current epoch of the DAO.

;; TRAITS
(impl-trait .dao-traits.extension)
(impl-trait .dao-traits.dao-epoch)

;; CONSTANTS

;; Contract details
(define-constant DEPLOYED_BURN_BLOCK burn-block-height)
(define-constant DEPLOYED_STACKS_BLOCK stacks-block-height)
(define-constant SELF (as-contract tx-sender))

;; Track epochs by BTC block height
;; 4320 blocks ~= 30 days (assuming ~10 min per BTC block)
(define-constant EPOCH_LENGTH u4320)

;; PUBLIC FUNCTIONS

;; Extension callback - required by extension trait
(define-public (callback (sender principal) (memo (buff 34)))
  (ok true)
)

;; READ-ONLY FUNCTIONS

;; Returns the current epoch based on deployed burn block
(define-read-only (get-current-dao-epoch)
  (ok (/ (- burn-block-height DEPLOYED_BURN_BLOCK) EPOCH_LENGTH))
)

;; Returns the epoch length in burn blocks
(define-read-only (get-dao-epoch-length)
  (ok EPOCH_LENGTH)
)

;; Get contract info
(define-read-only (get-contract-info)
  {
    self: SELF,
    deployedBurnBlock: DEPLOYED_BURN_BLOCK,
    deployedStacksBlock: DEPLOYED_STACKS_BLOCK,
    epochLength: EPOCH_LENGTH
  }
)
