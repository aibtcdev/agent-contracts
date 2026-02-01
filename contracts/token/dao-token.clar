;; title: dao-token
;; version: 1.0.0
;; summary: sBTC-backed DAO token with entrance tax mechanism.
;; description: A SIP-010 fungible token backed 1:1 by sBTC with an entrance tax
;; on deposits that goes to the treasury. Exit is always 1:1 with no exit tax.
;; Tax rate changes are time-delayed for user protection.

;; TRAITS
(impl-trait 'SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE.sip-010-trait-ft-standard.sip-010-trait)
(impl-trait .dao-traits.token)
(impl-trait .dao-traits.token-owner)

;; TOKEN DEFINITION
(define-fungible-token dao-token)

;; CONSTANTS

;; Contract references
(define-constant CONTRACT_DEPLOYER tx-sender)
(define-constant DAO_CONTRACT (as-contract tx-sender))

;; Tax configuration
;; Basis points: 10000 = 100%, 1000 = 10%, 100 = 1%
(define-constant MAX_TAX_RATE u5000) ;; Maximum 50% tax
(define-constant TAX_CHANGE_DELAY u1008) ;; ~7 days in Stacks blocks (144 blocks/day)

;; Error codes
(define-constant ERR_NOT_AUTHORIZED (err u2000))
(define-constant ERR_NOT_TOKEN_OWNER (err u2001))
(define-constant ERR_INSUFFICIENT_BALANCE (err u2002))
(define-constant ERR_INVALID_AMOUNT (err u2003))
(define-constant ERR_TAX_TOO_HIGH (err u2004))
(define-constant ERR_NO_PENDING_CHANGE (err u2005))
(define-constant ERR_CHANGE_NOT_READY (err u2006))
(define-constant ERR_INSUFFICIENT_BACKING (err u2007))

;; DATA VARS

;; Token metadata
(define-data-var token-uri (optional (string-utf8 256)) (some u"https://dao.example.com/token-metadata.json"))
(define-data-var token-owner principal CONTRACT_DEPLOYER)

;; Treasury address where entrance tax is sent
(define-data-var treasury-address principal CONTRACT_DEPLOYER)

;; Tax configuration
;; Current active entrance tax (in basis points, e.g., 1000 = 10%)
(define-data-var entrance-tax uint u1000)
;; Pending tax change (none if no change pending)
(define-data-var pending-entrance-tax (optional uint) none)
;; Block height when pending tax becomes active
(define-data-var tax-change-block uint u0)

;; Backing tracker - total sBTC held by this contract to back tokens
(define-data-var total-backing uint u0)

;; PUBLIC FUNCTIONS

;; ============================================================
;; SIP-010 FUNGIBLE TOKEN INTERFACE
;; ============================================================

;; SIP-010: transfer
(define-public (transfer (amount uint) (sender principal) (recipient principal) (memo (optional (buff 34))))
  (begin
    (asserts! (is-eq tx-sender sender) ERR_NOT_TOKEN_OWNER)
    (match memo to-print (print to-print) 0x)
    (print {
      notification: "dao-token/transfer",
      payload: {
        amount: amount,
        sender: sender,
        recipient: recipient,
        memo: memo
      }
    })
    (ft-transfer? dao-token amount sender recipient)
  )
)

;; ============================================================
;; DEPOSIT/WITHDRAW FUNCTIONS
;; ============================================================

;; Deposit sBTC and receive DAO tokens (minus entrance tax)
;; Tax portion is sent to treasury, remaining sBTC backs minted tokens 1:1
(define-public (deposit (amount uint))
  (let
    (
      (sender tx-sender)
      (treasury (var-get treasury-address))
      (current-tax (get-current-entrance-tax))
      (tax-amount (calculate-tax amount current-tax))
      (tokens-to-mint (- amount tax-amount))
    )
    ;; Validate amount
    (asserts! (> amount u0) ERR_INVALID_AMOUNT)
    (asserts! (> tokens-to-mint u0) ERR_INVALID_AMOUNT)

    ;; Transfer sBTC from sender to this contract
    ;; Note: Using mock-sbtc for testing, replace with actual sBTC contract for mainnet
    (try! (contract-call? .mock-sbtc transfer amount sender DAO_CONTRACT none))

    ;; Send tax portion to treasury (if tax > 0)
    (if (> tax-amount u0)
      (try! (as-contract (contract-call? .mock-sbtc transfer tax-amount DAO_CONTRACT treasury none)))
      true
    )

    ;; Update backing (only the amount after tax backs the tokens)
    (var-set total-backing (+ (var-get total-backing) tokens-to-mint))

    ;; Mint tokens to sender
    (try! (ft-mint? dao-token tokens-to-mint sender))

    (print {
      notification: "dao-token/deposit",
      payload: {
        sender: sender,
        amount: amount,
        tax-amount: tax-amount,
        tokens-minted: tokens-to-mint,
        tax-rate: current-tax,
        treasury: treasury
      }
    })
    (ok tokens-to-mint)
  )
)

;; Withdraw sBTC by burning DAO tokens - always 1:1, no exit tax
(define-public (withdraw (amount uint))
  (let
    (
      (sender tx-sender)
      (sender-balance (unwrap-panic (get-balance sender)))
      (current-backing (var-get total-backing))
    )
    ;; Validate amount
    (asserts! (> amount u0) ERR_INVALID_AMOUNT)
    (asserts! (>= sender-balance amount) ERR_INSUFFICIENT_BALANCE)
    (asserts! (>= current-backing amount) ERR_INSUFFICIENT_BACKING)

    ;; Burn tokens from sender
    (try! (ft-burn? dao-token amount sender))

    ;; Update backing
    (var-set total-backing (- current-backing amount))

    ;; Transfer sBTC back to sender (1:1, no exit tax)
    (try! (as-contract (contract-call? .mock-sbtc transfer amount DAO_CONTRACT sender none)))

    (print {
      notification: "dao-token/withdraw",
      payload: {
        sender: sender,
        amount: amount,
        remaining-backing: (var-get total-backing)
      }
    })
    (ok amount)
  )
)

;; ============================================================
;; DAO GOVERNANCE FUNCTIONS
;; ============================================================

;; Schedule a tax rate change (DAO-only, time-delayed)
(define-public (schedule-tax-change (new-tax uint))
  (begin
    ;; Only DAO or extensions can change tax
    (try! (is-dao-or-extension))
    ;; Validate new tax rate
    (asserts! (<= new-tax MAX_TAX_RATE) ERR_TAX_TOO_HIGH)
    ;; Set pending change with delay
    (var-set pending-entrance-tax (some new-tax))
    (var-set tax-change-block (+ stacks-block-height TAX_CHANGE_DELAY))

    (print {
      notification: "dao-token/schedule-tax-change",
      payload: {
        current-tax: (var-get entrance-tax),
        new-tax: new-tax,
        activation-block: (var-get tax-change-block)
      }
    })
    (ok true)
  )
)

;; Apply pending tax change after delay has passed (anyone can call)
(define-public (apply-pending-tax)
  (let
    (
      (pending-tax (var-get pending-entrance-tax))
      (change-block (var-get tax-change-block))
    )
    ;; Verify there's a pending change
    (asserts! (is-some pending-tax) ERR_NO_PENDING_CHANGE)
    ;; Verify delay has passed
    (asserts! (>= stacks-block-height change-block) ERR_CHANGE_NOT_READY)

    ;; Apply the change
    (var-set entrance-tax (unwrap-panic pending-tax))
    (var-set pending-entrance-tax none)
    (var-set tax-change-block u0)

    (print {
      notification: "dao-token/apply-pending-tax",
      payload: {
        new-tax: (var-get entrance-tax)
      }
    })
    (ok (var-get entrance-tax))
  )
)

;; Cancel a pending tax change (DAO-only)
(define-public (cancel-tax-change)
  (begin
    (try! (is-dao-or-extension))
    (asserts! (is-some (var-get pending-entrance-tax)) ERR_NO_PENDING_CHANGE)
    (var-set pending-entrance-tax none)
    (var-set tax-change-block u0)

    (print {
      notification: "dao-token/cancel-tax-change",
      payload: {
        current-tax: (var-get entrance-tax)
      }
    })
    (ok true)
  )
)

;; Set treasury address (DAO-only)
(define-public (set-treasury (new-treasury principal))
  (begin
    (try! (is-dao-or-extension))
    (var-set treasury-address new-treasury)

    (print {
      notification: "dao-token/set-treasury",
      payload: {
        treasury: new-treasury
      }
    })
    (ok true)
  )
)

;; ============================================================
;; TOKEN OWNER FUNCTIONS (implements token-owner trait)
;; ============================================================

;; Set token URI (DAO/token-owner only)
(define-public (set-token-uri (new-uri (string-utf8 256)))
  (begin
    (try! (is-token-owner-or-dao))
    (var-set token-uri (some new-uri))

    (print {
      notification: "dao-token/set-token-uri",
      payload: {
        uri: new-uri
      }
    })
    (ok true)
  )
)

;; Transfer token ownership (current owner only)
(define-public (transfer-ownership (new-owner principal))
  (begin
    (asserts! (is-eq tx-sender (var-get token-owner)) ERR_NOT_AUTHORIZED)
    (var-set token-owner new-owner)

    (print {
      notification: "dao-token/transfer-ownership",
      payload: {
        previous-owner: tx-sender,
        new-owner: new-owner
      }
    })
    (ok true)
  )
)

;; ============================================================
;; READ-ONLY FUNCTIONS
;; ============================================================

;; SIP-010: get-name
(define-read-only (get-name)
  (ok "DAO Token")
)

;; SIP-010: get-symbol
(define-read-only (get-symbol)
  (ok "DAO")
)

;; SIP-010: get-decimals
(define-read-only (get-decimals)
  (ok u8)
)

;; SIP-010: get-balance
(define-read-only (get-balance (who principal))
  (ok (ft-get-balance dao-token who))
)

;; SIP-010: get-total-supply
(define-read-only (get-total-supply)
  (ok (ft-get-supply dao-token))
)

;; SIP-010: get-token-uri
(define-read-only (get-token-uri)
  (ok (var-get token-uri))
)

;; Tax-related read functions

(define-read-only (get-entrance-tax)
  (var-get entrance-tax)
)

(define-read-only (get-current-entrance-tax)
  ;; If there's a pending change and it's active, return it
  ;; Otherwise return current tax
  (let
    (
      (pending-tax (var-get pending-entrance-tax))
      (change-block (var-get tax-change-block))
    )
    (if (and (is-some pending-tax) (>= stacks-block-height change-block))
      (unwrap-panic pending-tax)
      (var-get entrance-tax)
    )
  )
)

(define-read-only (get-pending-tax-change)
  {
    pending-tax: (var-get pending-entrance-tax),
    activation-block: (var-get tax-change-block),
    is-pending: (is-some (var-get pending-entrance-tax))
  }
)

(define-read-only (calculate-tax (amount uint) (tax-rate uint))
  (/ (* amount tax-rate) u10000)
)

(define-read-only (get-tokens-for-deposit (amount uint))
  (let
    (
      (current-tax (get-current-entrance-tax))
      (tax-amount (calculate-tax amount current-tax))
    )
    (- amount tax-amount)
  )
)

;; Backing-related read functions

(define-read-only (get-total-backing)
  (var-get total-backing)
)

(define-read-only (get-treasury)
  (var-get treasury-address)
)

(define-read-only (get-token-owner)
  (var-get token-owner)
)

(define-read-only (get-tax-change-delay)
  TAX_CHANGE_DELAY
)

(define-read-only (get-max-tax-rate)
  MAX_TAX_RATE
)

;; ============================================================
;; PRIVATE FUNCTIONS
;; ============================================================

;; Check if caller is DAO or an enabled extension
(define-private (is-dao-or-extension)
  (ok (asserts!
    (or
      (is-eq contract-caller .base-dao)
      (contract-call? .base-dao is-extension contract-caller)
    )
    ERR_NOT_AUTHORIZED
  ))
)

;; Check if caller is token owner or DAO/extension
(define-private (is-token-owner-or-dao)
  (ok (asserts!
    (or
      (is-eq tx-sender (var-get token-owner))
      (is-eq contract-caller .base-dao)
      (contract-call? .base-dao is-extension contract-caller)
    )
    ERR_NOT_AUTHORIZED
  ))
)
