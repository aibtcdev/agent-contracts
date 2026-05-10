;; title: aibtc-token
;; version: 1.0.0
;; summary: $AIBTC -- 1:1 sBTC-backed governance token for the AIBTC DAO.
;; description: A SIP-010 fungible token backed 1:1 by sBTC with NO entrance tax.
;; Deposit sBTC -> receive equal $AIBTC. Burn $AIBTC -> receive equal sBTC.
;; Every interaction calls heartbeat.beat for liveness tracking.
;; Forked from dao-token.clar with entrance tax logic removed per
;; DAO design consensus (locked decision #1).

;; TRAITS
(impl-trait 'SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE.sip-010-trait-ft-standard.sip-010-trait)
(impl-trait .dao-traits.token)
(impl-trait .dao-traits.token-owner)

;; TOKEN DEFINITION
(define-fungible-token aibtc-token)

;; CONSTANTS
(define-constant DAO_CONTRACT (as-contract tx-sender))

;; Error codes
(define-constant ERR_NOT_AUTHORIZED (err u2000))
(define-constant ERR_NOT_TOKEN_OWNER (err u2001))
(define-constant ERR_INSUFFICIENT_BALANCE (err u2002))
(define-constant ERR_INVALID_AMOUNT (err u2003))
;; u2004-u2006 removed: entrance tax codes deleted per locked decision #1 (no tax)
(define-constant ERR_INSUFFICIENT_BACKING (err u2007))

;; DATA VARS
(define-data-var token-uri (optional (string-utf8 256))
  (some u"https://aibtc.com/token-metadata.json"))
;; Token owner: deployer initially, init-proposal transfers to base-dao at bootstrap
(define-data-var token-owner principal tx-sender)

;; ============================================================
;; SIP-010 FUNGIBLE TOKEN INTERFACE
;; ============================================================

(define-public (transfer (amount uint) (sender principal) (recipient principal) (memo (optional (buff 34))))
  (begin
    (asserts! (is-eq tx-sender sender) ERR_NOT_TOKEN_OWNER)
    ;; Record liveness -- don't fail transfer if heartbeat errors
    (match (contract-call? .heartbeat beat sender) ok-val true err-val true)
    (match memo to-print (print to-print) 0x)
    (print {
      notification: "aibtc-token/transfer",
      payload: { amount: amount, sender: sender, recipient: recipient }
    })
    (ft-transfer? aibtc-token amount sender recipient)
  )
)

;; ============================================================
;; DEPOSIT / WITHDRAW -- Pure 1:1, no tax
;; ============================================================

;; @desc Deposit sBTC and receive equal $AIBTC tokens. No entrance tax.
;; @param amount - sBTC amount in sats to deposit
;; @returns (response uint uint) - tokens minted (always == amount)
(define-public (deposit (amount uint))
  (let
    (
      (sender tx-sender)
    )
    (asserts! (> amount u0) ERR_INVALID_AMOUNT)

    ;; Transfer sBTC from sender to this contract
    (try! (contract-call?
      .mock-sbtc
      transfer amount sender DAO_CONTRACT none))

    ;; Mint equal tokens (backing = ft-get-supply, always in sync)
    (try! (ft-mint? aibtc-token amount sender))

    ;; Record liveness -- don't fail deposit if heartbeat errors
    (match (contract-call? .heartbeat beat sender) ok-val true err-val true)

    (print {
      notification: "aibtc-token/deposit",
      payload: { sender: sender, amount: amount }
    })
    (ok amount)
  )
)

;; @desc Withdraw sBTC by burning $AIBTC tokens. Always 1:1, no exit tax.
;; @param amount - $AIBTC amount to burn and redeem for sBTC
;; @returns (response uint uint) - sBTC returned (always == amount)
(define-public (withdraw (amount uint))
  (let
    (
      (sender tx-sender)
      (sender-balance (ft-get-balance aibtc-token sender))
    )
    (asserts! (> amount u0) ERR_INVALID_AMOUNT)
    (asserts! (>= sender-balance amount) ERR_INSUFFICIENT_BALANCE)

    ;; Burn tokens
    (try! (ft-burn? aibtc-token amount sender))

    ;; Return sBTC 1:1 (backing = contract's sBTC balance, always >= total supply)
    (try! (as-contract (contract-call?
      .mock-sbtc
      transfer amount DAO_CONTRACT sender none)))

    ;; Record liveness -- don't fail withdraw if heartbeat errors
    (match (contract-call? .heartbeat beat sender) ok-val true err-val true)

    (print {
      notification: "aibtc-token/withdraw",
      payload: { sender: sender, amount: amount }
    })
    (ok amount)
  )
)

;; ============================================================
;; DAO GOVERNANCE FUNCTIONS
;; ============================================================

;; @desc Set token URI (DAO/extensions only)
(define-public (set-token-uri (new-uri (string-utf8 256)))
  (begin
    (try! (is-token-owner-or-dao))
    (var-set token-uri (some new-uri))
    (print {
      notification: "aibtc-token/set-token-uri",
      payload: { uri: new-uri }
    })
    (ok true)
  )
)

;; @desc Transfer token ownership (current owner only)
(define-public (transfer-ownership (new-owner principal))
  (begin
    (asserts! (is-eq tx-sender (var-get token-owner)) ERR_NOT_AUTHORIZED)
    (var-set token-owner new-owner)
    (print {
      notification: "aibtc-token/transfer-ownership",
      payload: { previous-owner: tx-sender, new-owner: new-owner }
    })
    (ok true)
  )
)

;; ============================================================
;; READ-ONLY FUNCTIONS
;; ============================================================

(define-read-only (get-name)
  (ok "AIBTC Token"))

(define-read-only (get-symbol)
  (ok "AIBTC"))

(define-read-only (get-decimals)
  (ok u8))

(define-read-only (get-balance (who principal))
  (ok (ft-get-balance aibtc-token who)))

(define-read-only (get-total-supply)
  (ok (ft-get-supply aibtc-token)))

(define-read-only (get-token-uri)
  (ok (var-get token-uri)))

;; Backing = contract's sBTC balance (always in sync, no separate var needed)
(define-read-only (get-total-backing)
  (unwrap-panic (contract-call? .mock-sbtc get-balance DAO_CONTRACT)))

(define-read-only (get-token-owner)
  (var-get token-owner))

;; ============================================================
;; PRIVATE FUNCTIONS
;; ============================================================

(define-private (is-dao-or-extension)
  (ok (asserts!
    (or
      (is-eq contract-caller .base-dao)
      (contract-call? .base-dao is-extension contract-caller)
    )
    ERR_NOT_AUTHORIZED
  ))
)

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
