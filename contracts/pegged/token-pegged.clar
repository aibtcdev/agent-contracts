;; title: token-pegged
;; version: 2.0.0
;; summary: SIP-010 pegged DAO token with 1:1 sBTC backing and entrance tax.
;; description: A simple sBTC-backed token for agent DAOs. Deposit sBTC to mint
;; tokens (minus entrance tax to treasury). Burn tokens to redeem pro-rata sBTC
;; at any time. Designed for Phase 1 (pegged) operation. The upgrade-to-free-floating
;; extension handles the Phase 2 transition.
;; v2: Identical logic to v1 with all security fixes carried forward.

;; TRAITS
(impl-trait 'SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE.sip-010-trait-ft-standard.sip-010-trait)

;; TOKEN DEFINITION
(define-fungible-token pegged-dao-token)

;; CONSTANTS
(define-constant SELF (as-contract tx-sender))
(define-constant DEPLOYER tx-sender)
(define-constant MAX_TAX_RATE u1000) ;; 10% maximum entrance tax
(define-constant BASIS_POINTS u10000)

;; Error codes (6000 range)
(define-constant ERR_NOT_AUTHORIZED (err u6000))
(define-constant ERR_ZERO_AMOUNT (err u6001))
(define-constant ERR_INSUFFICIENT_BALANCE (err u6002))
(define-constant ERR_INSUFFICIENT_BACKING (err u6003))
(define-constant ERR_PEGGED_MODE_ONLY (err u6004))
(define-constant ERR_TAX_TOO_HIGH (err u6005))
(define-constant ERR_ALREADY_INITIALIZED (err u6006))

;; DATA VARS
(define-data-var token-name (string-ascii 32) "Pegged DAO Token")
(define-data-var token-symbol (string-ascii 10) "pDAO")
(define-data-var token-uri (optional (string-utf8 256)) none)
(define-data-var entrance-tax-rate uint u100) ;; default 1% (100 basis points)
(define-data-var treasury-address principal DEPLOYER)
(define-data-var total-backing uint u0)
(define-data-var pegged bool true) ;; false after upgrade to free-floating
(define-data-var initialized bool false)

;; ============================================================
;; INITIALIZATION (called by init proposal via DAO)
;; ============================================================

(define-public (initialize
    (name (string-ascii 32))
    (symbol (string-ascii 10))
    (tax-rate uint)
    (treasury principal)
  )
  (begin
    (try! (is-dao-or-extension))
    (asserts! (not (var-get initialized)) ERR_ALREADY_INITIALIZED)
    (asserts! (<= tax-rate MAX_TAX_RATE) ERR_TAX_TOO_HIGH)
    (var-set token-name name)
    (var-set token-symbol symbol)
    (var-set entrance-tax-rate tax-rate)
    (var-set treasury-address treasury)
    (var-set initialized true)
    (print {
      notification: "token-pegged/initialize",
      payload: { name: name, symbol: symbol, tax-rate: tax-rate, treasury: treasury }
    })
    (ok true)
  )
)

;; ============================================================
;; SIP-010 INTERFACE
;; ============================================================

(define-public (transfer (amount uint) (sender principal) (recipient principal) (memo (optional (buff 34))))
  (begin
    (asserts! (is-eq tx-sender sender) ERR_NOT_AUTHORIZED)
    (asserts! (> amount u0) ERR_ZERO_AMOUNT)
    (match memo to-print (print to-print) 0x)
    (ft-transfer? pegged-dao-token amount sender recipient)
  )
)

(define-read-only (get-name) (ok (var-get token-name)))
(define-read-only (get-symbol) (ok (var-get token-symbol)))
(define-read-only (get-decimals) (ok u8))
(define-read-only (get-balance (who principal)) (ok (ft-get-balance pegged-dao-token who)))
(define-read-only (get-total-supply) (ok (ft-get-supply pegged-dao-token)))
(define-read-only (get-token-uri) (ok (var-get token-uri)))

;; ============================================================
;; DEPOSIT / MINT (1:1 sBTC peg with entrance tax)
;; ============================================================

;; Deposit sBTC, receive tokens. Entrance tax goes to treasury.
(define-public (deposit (amount uint))
  (let
    (
      (sender tx-sender)
      (treasury (var-get treasury-address))
      (tax (calculate-tax amount))
      (tokens-to-mint (- amount tax))
    )
    (asserts! (var-get initialized) ERR_NOT_AUTHORIZED)
    (asserts! (var-get pegged) ERR_PEGGED_MODE_ONLY)
    (asserts! (> amount u0) ERR_ZERO_AMOUNT)
    (asserts! (> tokens-to-mint u0) ERR_ZERO_AMOUNT)
    ;; Transfer sBTC from sender to this contract
    (try! (contract-call? .mock-sbtc transfer amount sender SELF none))
    ;; Send tax to treasury (if any)
    (if (> tax u0)
      (try! (as-contract (contract-call? .mock-sbtc transfer tax SELF treasury none)))
      true
    )
    ;; Track backing and mint tokens
    (var-set total-backing (+ (var-get total-backing) tokens-to-mint))
    (try! (ft-mint? pegged-dao-token tokens-to-mint sender))
    (print {
      notification: "token-pegged/deposit",
      payload: {
        sender: sender, amount: amount, tax: tax,
        tokens-minted: tokens-to-mint, treasury: treasury
      }
    })
    (ok tokens-to-mint)
  )
)

;; ============================================================
;; REDEEM / BURN (anytime, pro-rata sBTC)
;; ============================================================

;; Burn tokens, receive pro-rata sBTC. No exit tax.
(define-public (redeem (amount uint))
  (let
    (
      (sender tx-sender)
      (balance (ft-get-balance pegged-dao-token sender))
      (supply (ft-get-supply pegged-dao-token))
      (backing (var-get total-backing))
      ;; Pro-rata: (amount / supply) * backing
      (sbtc-out (if (is-eq supply amount)
        backing ;; last redeemer gets everything (avoid rounding dust)
        (/ (* amount backing) supply)
      ))
    )
    (asserts! (var-get initialized) ERR_NOT_AUTHORIZED)
    (asserts! (var-get pegged) ERR_PEGGED_MODE_ONLY)
    (asserts! (> amount u0) ERR_ZERO_AMOUNT)
    (asserts! (>= balance amount) ERR_INSUFFICIENT_BALANCE)
    (asserts! (> sbtc-out u0) ERR_ZERO_AMOUNT) ;; Prevent dust burn for 0 sBTC
    (asserts! (>= backing sbtc-out) ERR_INSUFFICIENT_BACKING)
    ;; Burn tokens
    (try! (ft-burn? pegged-dao-token amount sender))
    ;; Update backing
    (var-set total-backing (- backing sbtc-out))
    ;; Transfer sBTC back
    (try! (as-contract (contract-call? .mock-sbtc transfer sbtc-out SELF sender none)))
    (print {
      notification: "token-pegged/redeem",
      payload: { sender: sender, tokens-burned: amount, sbtc-returned: sbtc-out }
    })
    (ok sbtc-out)
  )
)

;; ============================================================
;; DAO-ONLY FUNCTIONS
;; ============================================================

;; Mint tokens - restricted to upgrade extension only (not any extension)
(define-public (dao-mint (amount uint) (recipient principal))
  (begin
    (asserts! (is-upgrade-extension) ERR_NOT_AUTHORIZED)
    (ft-mint? pegged-dao-token amount recipient)
  )
)

;; Burn tokens from a holder - restricted to upgrade extension only
(define-public (dao-burn (amount uint) (holder principal))
  (begin
    (asserts! (is-upgrade-extension) ERR_NOT_AUTHORIZED)
    (ft-burn? pegged-dao-token amount holder)
  )
)

;; Set the peg status (called by upgrade-to-free-floating)
(define-public (set-pegged (is-pegged bool))
  (begin
    (try! (is-dao-or-extension))
    (var-set pegged is-pegged)
    (ok true)
  )
)

;; Set treasury address
(define-public (set-treasury (new-treasury principal))
  (begin
    (try! (is-dao-or-extension))
    (var-set treasury-address new-treasury)
    (ok true)
  )
)

;; Set entrance tax rate
(define-public (set-entrance-tax (new-rate uint))
  (begin
    (try! (is-dao-or-extension))
    (asserts! (<= new-rate MAX_TAX_RATE) ERR_TAX_TOO_HIGH)
    (var-set entrance-tax-rate new-rate)
    (ok true)
  )
)

;; Set token URI
(define-public (set-token-uri (new-uri (string-utf8 256)))
  (begin
    (try! (is-dao-or-extension))
    (var-set token-uri (some new-uri))
    (ok true)
  )
)

;; Withdraw backing sBTC (used during upgrade to move funds to new treasury)
(define-public (withdraw-backing (amount uint) (recipient principal))
  (let ((backing (var-get total-backing)))
    (try! (is-dao-or-extension))
    (asserts! (>= backing amount) ERR_INSUFFICIENT_BACKING)
    (var-set total-backing (- backing amount))
    (as-contract (contract-call? .mock-sbtc transfer amount SELF recipient none))
  )
)

;; ============================================================
;; READ-ONLY FUNCTIONS
;; ============================================================

(define-read-only (get-entrance-tax-rate) (var-get entrance-tax-rate))
(define-read-only (get-total-backing) (var-get total-backing))
(define-read-only (get-treasury-address) (var-get treasury-address))
(define-read-only (get-is-pegged) (var-get pegged))
(define-read-only (is-initialized) (var-get initialized))

(define-read-only (calculate-tax (amount uint))
  (/ (* amount (var-get entrance-tax-rate)) BASIS_POINTS)
)

(define-read-only (get-sbtc-for-tokens (token-amount uint))
  (let
    (
      (supply (ft-get-supply pegged-dao-token))
      (backing (var-get total-backing))
    )
    (if (or (is-eq supply u0) (is-eq token-amount u0))
      u0
      (if (is-eq supply token-amount)
        backing
        (/ (* token-amount backing) supply)
      )
    )
  )
)

;; Extension callback (required by extension trait pattern)
(define-public (callback (sender principal) (memo (buff 34)))
  (ok true)
)

;; ============================================================
;; PRIVATE FUNCTIONS
;; ============================================================

(define-private (is-dao-or-extension)
  (ok (asserts!
    (or
      (is-eq tx-sender .base-dao)
      (contract-call? .base-dao is-extension contract-caller)
    )
    ERR_NOT_AUTHORIZED
  ))
)

;; Only the upgrade extension can mint/burn tokens
(define-private (is-upgrade-extension)
  (or
    (is-eq contract-caller .upgrade-to-free-floating)
    (is-eq tx-sender .base-dao)
  )
)
