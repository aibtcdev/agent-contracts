;; title: sbtc-config
;; version: 1.0.0
;; summary: Configuration for sBTC contract reference
;; description: Allows switching between mock-sbtc (testing) and mainnet sBTC.
;; This contract documents which sBTC implementation is in use.

;; For simnet/devnet testing, this points to mock-sbtc
;; For mainnet deployment, redeploy with mainnet sBTC address
;;
;; Due to Clarity limitations, the contract principal must be known at compile time.
;; This config approach documents the change point for deployment but does not
;; enable runtime switching.

;; CONSTANTS

;; Testing configuration (simnet/devnet)
(define-constant SBTC_CONTRACT .mock-sbtc)

;; Mainnet configuration (uncomment for mainnet deployment):
;; (define-constant SBTC_CONTRACT 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token)

;; READ-ONLY FUNCTIONS

;; Get the configured sBTC contract principal
(define-read-only (get-sbtc-contract)
  SBTC_CONTRACT
)

;; Check if configured for mainnet
;; Returns true if using mainnet sBTC, false if using mock
(define-read-only (is-mainnet-config)
  ;; In testing config, this returns false
  ;; Change to true when deploying to mainnet
  false
)
