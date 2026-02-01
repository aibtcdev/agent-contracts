;; title: dao-token-owner
;; version: 1.0.0
;; summary: An extension that provides management functions for the DAO token.

;; TRAITS
(impl-trait .dao-traits.extension)
(impl-trait .dao-traits.token-owner)

;; CONSTANTS

;; Error codes
(define-constant ERR_NOT_DAO_OR_EXTENSION (err u1800))
(define-constant ERR_NO_PENDING_CHANGE (err u1801))
(define-constant ERR_CHANGE_NOT_READY (err u1802))
(define-constant ERR_PENDING_CHANGE_EXISTS (err u1803))

;; Ownership change delay (~7 days in Stacks blocks, 144 blocks/day)
(define-constant OWNERSHIP_CHANGE_DELAY u1008)

;; Contract details
(define-constant DEPLOYED_BURN_BLOCK burn-block-height)
(define-constant DEPLOYED_STACKS_BLOCK stacks-block-height)
(define-constant SELF (as-contract tx-sender))

;; DATA VARS

;; Pending ownership change (none if no change pending)
(define-data-var pending-owner (optional principal) none)
;; Block height when pending ownership change becomes active
(define-data-var ownership-change-block uint u0)

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
;; NOTE: This is kept for trait compliance. Prefer using schedule/apply pattern for timelock protection.
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

;; Schedule ownership transfer with timelock (DAO/extension only)
(define-public (schedule-ownership-transfer (new-owner principal))
  (begin
    (try! (is-dao-or-extension))
    ;; Ensure no pending change exists
    (asserts! (is-none (var-get pending-owner)) ERR_PENDING_CHANGE_EXISTS)
    ;; Set pending change
    (var-set pending-owner (some new-owner))
    (var-set ownership-change-block (+ stacks-block-height OWNERSHIP_CHANGE_DELAY))
    (print {
      notification: "dao-token-owner/schedule-ownership-transfer",
      payload: {
        newOwner: new-owner,
        activationBlock: (var-get ownership-change-block),
        contractCaller: contract-caller,
        txSender: tx-sender
      }
    })
    (ok true)
  )
)

;; Apply pending ownership transfer after timelock (anyone can call)
(define-public (apply-pending-ownership)
  (let (
      (new-owner (unwrap! (var-get pending-owner) ERR_NO_PENDING_CHANGE))
    )
    ;; Anyone can call after delay (no auth check - similar to dao-token)
    (asserts! (>= stacks-block-height (var-get ownership-change-block)) ERR_CHANGE_NOT_READY)
    ;; Clear pending state
    (var-set pending-owner none)
    (var-set ownership-change-block u0)
    ;; Execute ownership transfer
    (try! (as-contract (contract-call? .dao-token transfer-ownership new-owner)))
    (print {
      notification: "dao-token-owner/apply-pending-ownership",
      payload: { newOwner: new-owner }
    })
    (ok true)
  )
)

;; Cancel pending ownership transfer (DAO/extension only)
(define-public (cancel-ownership-transfer)
  (begin
    (try! (is-dao-or-extension))
    (asserts! (is-some (var-get pending-owner)) ERR_NO_PENDING_CHANGE)
    (var-set pending-owner none)
    (var-set ownership-change-block u0)
    (print {
      notification: "dao-token-owner/cancel-ownership-transfer",
      payload: { contractCaller: contract-caller, txSender: tx-sender }
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

;; Get pending ownership change info
(define-read-only (get-pending-ownership-change)
  {
    pending-owner: (var-get pending-owner),
    activation-block: (var-get ownership-change-block),
    is-pending: (is-some (var-get pending-owner))
  }
)

;; Get the ownership change delay constant
(define-read-only (get-ownership-change-delay)
  OWNERSHIP_CHANGE_DELAY
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
