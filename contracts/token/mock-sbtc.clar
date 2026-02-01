;; title: mock-sbtc
;; version: 1.0.0
;; summary: Mock sBTC token for testing dao-token deposit/withdraw functionality.
;; description: Simple SIP-010 compliant token that simulates sBTC for local testing.

;; TRAITS
(impl-trait 'SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE.sip-010-trait-ft-standard.sip-010-trait)

;; TOKEN DEFINITION
(define-fungible-token sbtc)

;; CONSTANTS
(define-constant ERR_NOT_TOKEN_OWNER (err u1000))
(define-constant ERR_INSUFFICIENT_BALANCE (err u1001))
(define-constant CONTRACT_OWNER tx-sender)

;; DATA VARS
(define-data-var token-uri (optional (string-utf8 256)) (some u"https://example.com/mock-sbtc.json"))

;; PUBLIC FUNCTIONS

;; SIP-010: transfer
(define-public (transfer (amount uint) (sender principal) (recipient principal) (memo (optional (buff 34))))
  (begin
    (asserts! (is-eq tx-sender sender) ERR_NOT_TOKEN_OWNER)
    (match memo to-print (print to-print) 0x)
    (ft-transfer? sbtc amount sender recipient)
  )
)

;; Mint tokens for testing (only deployer can mint)
(define-public (mint (amount uint) (recipient principal))
  (begin
    (asserts! (is-eq tx-sender CONTRACT_OWNER) ERR_NOT_TOKEN_OWNER)
    (ft-mint? sbtc amount recipient)
  )
)

;; READ-ONLY FUNCTIONS

;; SIP-010: get-name
(define-read-only (get-name)
  (ok "Mock sBTC")
)

;; SIP-010: get-symbol
(define-read-only (get-symbol)
  (ok "sBTC")
)

;; SIP-010: get-decimals
(define-read-only (get-decimals)
  (ok u8)
)

;; SIP-010: get-balance
(define-read-only (get-balance (who principal))
  (ok (ft-get-balance sbtc who))
)

;; SIP-010: get-total-supply
(define-read-only (get-total-supply)
  (ok (ft-get-supply sbtc))
)

;; SIP-010: get-token-uri
(define-read-only (get-token-uri)
  (ok (var-get token-uri))
)
