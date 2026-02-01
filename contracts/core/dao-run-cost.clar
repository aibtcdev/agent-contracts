;; title: dao-run-cost
;; version: 1.0.0
;; summary: A multisig contract for humans to fund DAO compute costs.
;; description: Independent from DAO governance - this is human-controlled for operational expenses.
;;              Requires M-of-N owner approval for all actions. Proposals expire after 144 blocks (~1 day).

;; TRAITS

(use-trait sip010-trait 'SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE.sip-010-trait-ft-standard.sip-010-trait)

;; CONSTANTS

;; error codes
(define-constant ERR_NOT_OWNER (err u2000))
(define-constant ERR_ASSET_NOT_ALLOWED (err u2001))
(define-constant ERR_PROPOSAL_MISMATCH (err u2002))
(define-constant ERR_SAVING_PROPOSAL (err u2003))
(define-constant ERR_PROPOSAL_EXPIRED (err u2004))
(define-constant ERR_ALREADY_EXECUTED (err u2005))
(define-constant ERR_INVALID_CONFIRMATIONS (err u2006))
(define-constant ERR_ALREADY_CONFIRMED (err u2007))

;; contract details
(define-constant DEPLOYED_BURN_BLOCK burn-block-height)
(define-constant DEPLOYED_STACKS_BLOCK stacks-block-height)
(define-constant SELF (as-contract tx-sender))

;; proposal types
(define-constant SET_OWNER u1)
(define-constant SET_ASSET u2)
(define-constant TRANSFER u3)
(define-constant SET_CONFIRMATIONS u4)

;; proposal expiration (~1 day at 10 min blocks)
(define-constant PROPOSAL_EXPIRATION u144)

;; DATA VARS

;; M of N confirmations required (default: 2)
(define-data-var confirmations-required uint u2)

;; proposal nonces
(define-data-var set-owner-nonce uint u0)
(define-data-var set-asset-nonce uint u0)
(define-data-var transfer-nonce uint u0)
(define-data-var set-confirmations-nonce uint u0)

;; track total owners for validation
(define-data-var total-owners uint u0)

;; DATA MAPS

(define-map Owners
  principal ;; owner
  bool      ;; enabled
)

(define-map SetOwnerProposals
  uint ;; nonce
  {
    who: principal,
    status: bool,
    created-at: uint,
    executed: (optional uint)
  }
)

(define-map SetAssetProposals
  uint ;; nonce
  {
    token: principal,
    enabled: bool,
    created-at: uint,
    executed: (optional uint)
  }
)

(define-map TransferProposals
  uint ;; nonce
  {
    ft: principal,
    amount: uint,
    recipient: principal,
    created-at: uint,
    executed: (optional uint)
  }
)

(define-map SetConfirmationsProposals
  uint ;; nonce
  {
    required: uint,
    created-at: uint,
    executed: (optional uint)
  }
)

(define-map OwnerConfirmations
  {
    proposal-type: uint,
    nonce: uint,
    owner: principal
  }
  bool ;; confirmed
)

(define-map TotalConfirmations
  {
    proposal-type: uint,
    nonce: uint
  }
  uint ;; total confirmations
)

(define-map AllowedAssets
  principal ;; asset contract
  bool      ;; enabled
)

;; PUBLIC FUNCTIONS

;; Propose/confirm adding or removing an owner
(define-public (set-owner (nonce uint) (who principal) (status bool))
  (begin
    (asserts! (is-owner contract-caller) ERR_NOT_OWNER)
    (match (map-get? SetOwnerProposals nonce)
      proposal
        (begin
          ;; Existing proposal - verify parameters match
          (asserts! (is-eq (get who proposal) who) ERR_PROPOSAL_MISMATCH)
          (asserts! (is-eq (get status proposal) status) ERR_PROPOSAL_MISMATCH)
        )
      ;; New proposal - create it
      (begin
        (var-set set-owner-nonce (+ (var-get set-owner-nonce) u1))
        (asserts!
          (map-insert SetOwnerProposals nonce {
            who: who,
            status: status,
            created-at: burn-block-height,
            executed: none
          })
          ERR_SAVING_PROPOSAL
        )
      )
    )
    (print {
      notification: "dao-run-cost/set-owner",
      payload: {
        nonce: nonce,
        who: who,
        status: status,
        caller: contract-caller
      }
    })
    (ok (and (try! (add-confirmation SET_OWNER nonce)) (execute-set-owner nonce)))
  )
)

;; Propose/confirm allowing or disallowing an asset
(define-public (set-asset (nonce uint) (token principal) (enabled bool))
  (begin
    (asserts! (is-owner contract-caller) ERR_NOT_OWNER)
    (match (map-get? SetAssetProposals nonce)
      proposal
        (begin
          (asserts! (is-eq (get token proposal) token) ERR_PROPOSAL_MISMATCH)
          (asserts! (is-eq (get enabled proposal) enabled) ERR_PROPOSAL_MISMATCH)
        )
      (begin
        (var-set set-asset-nonce (+ (var-get set-asset-nonce) u1))
        (asserts!
          (map-insert SetAssetProposals nonce {
            token: token,
            enabled: enabled,
            created-at: burn-block-height,
            executed: none
          })
          ERR_SAVING_PROPOSAL
        )
      )
    )
    (print {
      notification: "dao-run-cost/set-asset",
      payload: {
        nonce: nonce,
        token: token,
        enabled: enabled,
        caller: contract-caller
      }
    })
    (ok (and (try! (add-confirmation SET_ASSET nonce)) (execute-set-asset nonce)))
  )
)

;; Propose/confirm transferring tokens from the multisig
(define-public (transfer-token (nonce uint) (ft <sip010-trait>) (amount uint) (recipient principal))
  (begin
    (asserts! (is-owner contract-caller) ERR_NOT_OWNER)
    (asserts! (is-allowed-asset (contract-of ft)) ERR_ASSET_NOT_ALLOWED)
    (match (map-get? TransferProposals nonce)
      proposal
        (begin
          (asserts! (is-eq (get ft proposal) (contract-of ft)) ERR_PROPOSAL_MISMATCH)
          (asserts! (is-eq (get amount proposal) amount) ERR_PROPOSAL_MISMATCH)
          (asserts! (is-eq (get recipient proposal) recipient) ERR_PROPOSAL_MISMATCH)
        )
      (begin
        (var-set transfer-nonce (+ (var-get transfer-nonce) u1))
        (asserts!
          (map-insert TransferProposals nonce {
            ft: (contract-of ft),
            amount: amount,
            recipient: recipient,
            created-at: burn-block-height,
            executed: none
          })
          ERR_SAVING_PROPOSAL
        )
      )
    )
    (print {
      notification: "dao-run-cost/transfer-token",
      payload: {
        nonce: nonce,
        token: (contract-of ft),
        amount: amount,
        recipient: recipient,
        caller: contract-caller
      }
    })
    (ok (and (try! (add-confirmation TRANSFER nonce)) (execute-transfer nonce ft)))
  )
)

;; Propose/confirm changing the required confirmations threshold
(define-public (set-confirmations (nonce uint) (required uint))
  (begin
    (asserts! (is-owner contract-caller) ERR_NOT_OWNER)
    ;; Validate: required must be > 0 and <= total owners
    (asserts! (> required u0) ERR_INVALID_CONFIRMATIONS)
    (asserts! (<= required (var-get total-owners)) ERR_INVALID_CONFIRMATIONS)
    (match (map-get? SetConfirmationsProposals nonce)
      proposal
        (asserts! (is-eq (get required proposal) required) ERR_PROPOSAL_MISMATCH)
      (begin
        (var-set set-confirmations-nonce (+ (var-get set-confirmations-nonce) u1))
        (asserts!
          (map-insert SetConfirmationsProposals nonce {
            required: required,
            created-at: burn-block-height,
            executed: none
          })
          ERR_SAVING_PROPOSAL
        )
      )
    )
    (print {
      notification: "dao-run-cost/set-confirmations",
      payload: {
        nonce: nonce,
        required: required,
        caller: contract-caller
      }
    })
    (ok (and (try! (add-confirmation SET_CONFIRMATIONS nonce)) (execute-set-confirmations nonce)))
  )
)

;; READ-ONLY FUNCTIONS

(define-read-only (get-confirmations-required)
  (var-get confirmations-required)
)

(define-read-only (get-proposal-totals)
  {
    set-owner: (var-get set-owner-nonce),
    set-asset: (var-get set-asset-nonce),
    transfer: (var-get transfer-nonce),
    set-confirmations: (var-get set-confirmations-nonce)
  }
)

(define-read-only (get-total-owners)
  (var-get total-owners)
)

(define-read-only (is-owner (who principal))
  (default-to false (map-get? Owners who))
)

(define-read-only (get-set-owner-proposal (nonce uint))
  (map-get? SetOwnerProposals nonce)
)

(define-read-only (get-set-asset-proposal (nonce uint))
  (map-get? SetAssetProposals nonce)
)

(define-read-only (get-transfer-proposal (nonce uint))
  (map-get? TransferProposals nonce)
)

(define-read-only (get-set-confirmations-proposal (nonce uint))
  (map-get? SetConfirmationsProposals nonce)
)

(define-read-only (get-owner-confirmation (proposal-type uint) (nonce uint) (who principal))
  (default-to false
    (map-get? OwnerConfirmations {
      proposal-type: proposal-type,
      nonce: nonce,
      owner: who
    })
  )
)

(define-read-only (get-total-confirmations (proposal-type uint) (nonce uint))
  (default-to u0
    (map-get? TotalConfirmations {
      proposal-type: proposal-type,
      nonce: nonce
    })
  )
)

(define-read-only (get-allowed-asset (asset principal))
  (map-get? AllowedAssets asset)
)

(define-read-only (is-allowed-asset (asset principal))
  (default-to false (get-allowed-asset asset))
)

(define-read-only (get-contract-info)
  {
    self: SELF,
    deployed-burn-block: DEPLOYED_BURN_BLOCK,
    deployed-stacks-block: DEPLOYED_STACKS_BLOCK,
    confirmations-required: (var-get confirmations-required),
    total-owners: (var-get total-owners)
  }
)

;; PRIVATE FUNCTIONS

;; Add confirmation and check if threshold is met
(define-private (add-confirmation (proposal-type uint) (nonce uint))
  (let (
    (already-confirmed (get-owner-confirmation proposal-type nonce contract-caller))
    (current-confirmations (get-total-confirmations proposal-type nonce))
    (new-confirmations (if already-confirmed current-confirmations (+ current-confirmations u1)))
  )
    ;; Don't allow double confirmation
    (asserts! (not already-confirmed) ERR_ALREADY_CONFIRMED)
    ;; Record this owner's confirmation
    (map-set OwnerConfirmations
      { proposal-type: proposal-type, nonce: nonce, owner: contract-caller }
      true
    )
    ;; Update total confirmations
    (map-set TotalConfirmations
      { proposal-type: proposal-type, nonce: nonce }
      new-confirmations
    )
    ;; Return true if threshold met
    (ok (>= new-confirmations (var-get confirmations-required)))
  )
)

;; Check if proposal can still be executed (not expired)
(define-private (can-execute (created-at uint))
  (< burn-block-height (+ created-at PROPOSAL_EXPIRATION))
)

;; Execute set-owner proposal
(define-private (execute-set-owner (nonce uint))
  (let ((proposal (unwrap! (map-get? SetOwnerProposals nonce) false)))
    ;; Check not expired
    (asserts! (can-execute (get created-at proposal)) false)
    ;; Check not already executed
    (asserts! (is-none (get executed proposal)) false)
    ;; Update owner count
    (if (get status proposal)
      ;; Adding owner - only increment if not already owner
      (if (not (is-owner (get who proposal)))
        (var-set total-owners (+ (var-get total-owners) u1))
        false
      )
      ;; Removing owner - only decrement if currently owner
      (if (is-owner (get who proposal))
        (var-set total-owners (- (var-get total-owners) u1))
        false
      )
    )
    ;; Set owner status
    (map-set Owners (get who proposal) (get status proposal))
    ;; Mark as executed
    (map-set SetOwnerProposals nonce
      (merge proposal { executed: (some burn-block-height) })
    )
    (print {
      notification: "dao-run-cost/execute-set-owner",
      payload: {
        nonce: nonce,
        who: (get who proposal),
        status: (get status proposal),
        executed-at: burn-block-height
      }
    })
    true
  )
)

;; Execute set-asset proposal
(define-private (execute-set-asset (nonce uint))
  (let ((proposal (unwrap! (map-get? SetAssetProposals nonce) false)))
    (asserts! (can-execute (get created-at proposal)) false)
    (asserts! (is-none (get executed proposal)) false)
    (map-set AllowedAssets (get token proposal) (get enabled proposal))
    (map-set SetAssetProposals nonce
      (merge proposal { executed: (some burn-block-height) })
    )
    (print {
      notification: "dao-run-cost/execute-set-asset",
      payload: {
        nonce: nonce,
        token: (get token proposal),
        enabled: (get enabled proposal),
        executed-at: burn-block-height
      }
    })
    true
  )
)

;; Execute transfer proposal
(define-private (execute-transfer (nonce uint) (ft <sip010-trait>))
  (let ((proposal (unwrap! (map-get? TransferProposals nonce) false)))
    (asserts! (can-execute (get created-at proposal)) false)
    (asserts! (is-none (get executed proposal)) false)
    (map-set TransferProposals nonce
      (merge proposal { executed: (some burn-block-height) })
    )
    (print {
      notification: "dao-run-cost/execute-transfer",
      payload: {
        nonce: nonce,
        token: (get ft proposal),
        amount: (get amount proposal),
        recipient: (get recipient proposal),
        executed-at: burn-block-height
      }
    })
    (unwrap!
      (as-contract (contract-call? ft transfer
        (get amount proposal)
        SELF
        (get recipient proposal)
        none
      ))
      false
    )
  )
)

;; Execute set-confirmations proposal
(define-private (execute-set-confirmations (nonce uint))
  (let ((proposal (unwrap! (map-get? SetConfirmationsProposals nonce) false)))
    (asserts! (can-execute (get created-at proposal)) false)
    (asserts! (is-none (get executed proposal)) false)
    (var-set confirmations-required (get required proposal))
    (map-set SetConfirmationsProposals nonce
      (merge proposal { executed: (some burn-block-height) })
    )
    (print {
      notification: "dao-run-cost/execute-set-confirmations",
      payload: {
        nonce: nonce,
        required: (get required proposal),
        executed-at: burn-block-height
      }
    })
    true
  )
)

;; INITIALIZATION

(begin
  ;; Set initial owners (3 owners for 2-of-3 multisig)
  (map-set Owners 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM true) ;; deployer
  (map-set Owners 'ST1SJ3DTE5DN7X54YDH5D64R3BCB6A2AG2ZQ8YPD5 true) ;; wallet_1
  (map-set Owners 'ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6XX4CFRK9AG true) ;; wallet_2
  (var-set total-owners u3)
  ;; Print contract info
  (print (get-contract-info))
)
