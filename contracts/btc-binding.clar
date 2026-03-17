;; title: btc-binding
;; version: 1.0.0
;; summary: L1-L2 identity link -- verifies BTC ownership on-chain.
;; description: Agents prove they control a BTC address by signing a
;; challenge message with their BTC private key. The contract recovers
;; the public key via secp256k1 and stores the verified binding.
;; This bridges Bitcoin L1 identity with Stacks L2 identity,
;; complementing the ERC-8004 identity registry.

;; =========================================
;; CONSTANTS
;; =========================================

(define-constant ERR_INVALID_SIGNATURE (err u4000))
(define-constant ERR_KEY_MISMATCH (err u4001))
(define-constant ERR_ALREADY_BOUND (err u4002))
(define-constant ERR_NOT_AUTHORIZED (err u4003))

;; The challenge message agents must sign to prove BTC ownership.
;; Using a fixed domain-separated string prevents replay attacks
;; across different protocols.
;;
;; NOTE: This uses plain sha256, NOT BIP-137/BIP-322 Bitcoin message signing.
;; Standard wallet signMessage() (Leather, Xverse) won't produce compatible
;; signatures. Agents must use custom signing code or the agent SDK.
;; This is intentional -- BIP-137 adds variable-length encoding that
;; complicates on-chain recovery. Document this for implementors.
(define-constant BINDING_CHALLENGE 0x414942544320425443204f776e65727368697020566572696669636174696f6e)
;; = "AIBTC BTC Ownership Verification" in hex

;; =========================================
;; DATA STORAGE
;; =========================================

;; Maps Stacks principal to their verified BTC public key (33-byte compressed)
(define-map btc-bindings principal (buff 33))

;; Reverse map: BTC pubkey to Stacks principal (prevents one key binding to multiple principals)
(define-map reverse-bindings (buff 33) principal)

;; Total verified bindings
(define-data-var total-bindings uint u0)

;; =========================================
;; PUBLIC FUNCTIONS
;; =========================================

;; @desc Verify BTC ownership and bind the recovered pubkey to tx-sender.
;; Agent signs BINDING_CHALLENGE with their BTC key, submits the signature.
;; Contract recovers the pubkey and stores the binding.
;; @param signature - 65-byte recoverable signature (r, s, recovery-id)
;; @returns (response (buff 33) uint) - the verified public key
(define-public (bind-btc (signature (buff 65)))
  (let
    (
      (caller tx-sender)
      (message-hash (sha256 BINDING_CHALLENGE))
      (recovered-key (unwrap! (secp256k1-recover? message-hash signature) ERR_INVALID_SIGNATURE))
    )
    ;; Check this pubkey isn't already bound to a different principal
    (match (map-get? reverse-bindings recovered-key)
      existing-principal
        (asserts! (is-eq existing-principal caller) ERR_ALREADY_BOUND)
      true
    )

    ;; Capture first-binding status BEFORE map-set (map-set overwrites, making is-none always false after)
    (let
      (
        (is-new (is-none (map-get? btc-bindings caller)))
      )
      ;; Store the binding
      (map-set btc-bindings caller recovered-key)
      (map-set reverse-bindings recovered-key caller)

      ;; Increment counter on first binding only
      (if is-new
        (var-set total-bindings (+ (var-get total-bindings) u1))
        false
      )

      ;; Record heartbeat
      (try! (contract-call? .heartbeat beat caller))

      (print {
        notification: "btc-binding/bind",
        payload: {
          principal: caller,
          btc-pubkey: recovered-key
        }
      })
      (ok recovered-key)
    )
  )
)

;; @desc Remove BTC binding for tx-sender. Only the bound principal can unbind.
;; @returns (response bool uint)
(define-public (unbind-btc)
  (let
    (
      (caller tx-sender)
      (current-key (unwrap! (map-get? btc-bindings caller) ERR_KEY_MISMATCH))
    )
    (map-delete btc-bindings caller)
    (map-delete reverse-bindings current-key)

    (print {
      notification: "btc-binding/unbind",
      payload: {
        principal: caller,
        removed-pubkey: current-key
      }
    })
    (ok true)
  )
)

;; =========================================
;; READ-ONLY FUNCTIONS
;; =========================================

;; @desc Get the verified BTC public key for a Stacks principal
;; @param who - The principal to query
;; @returns (optional (buff 33)) - compressed pubkey or none
(define-read-only (get-btc-key (who principal))
  (map-get? btc-bindings who)
)

;; @desc Get the Stacks principal bound to a BTC public key
;; @param pubkey - 33-byte compressed public key
;; @returns (optional principal) - Stacks principal or none
(define-read-only (get-principal-for-key (pubkey (buff 33)))
  (map-get? reverse-bindings pubkey)
)

;; @desc Check if a principal has a verified BTC binding
;; @param who - The principal to check
;; @returns bool
(define-read-only (is-bound (who principal))
  (is-some (map-get? btc-bindings who))
)

;; @desc Get total number of verified bindings
;; @returns uint
(define-read-only (get-total-bindings)
  (var-get total-bindings)
)

;; @desc Get the challenge message that must be signed
;; @returns (buff 32) - the challenge bytes
(define-read-only (get-challenge)
  BINDING_CHALLENGE
)
