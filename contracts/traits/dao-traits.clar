;; title: dao-traits
;; version: 1.0.0
;; summary: Core trait definitions for the simplified agent DAO.

;; IMPORTS
(use-trait ft-trait 'SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE.sip-010-trait-ft-standard.sip-010-trait)

;; ============================================================
;; CORE DAO TRAITS
;; ============================================================

;; A one-time executable action proposed by token holders.
;; Proposals are executed once and then complete.
(define-trait proposal (
  (execute
    (principal)
    (response bool uint)
  )
))

;; A standing feature of the DAO implemented in Clarity.
;; Extensions persist and provide ongoing functionality.
(define-trait extension (
  (callback
    (principal (buff 34))
    (response bool uint)
  )
))

;; ============================================================
;; TOKEN TRAITS
;; ============================================================

;; The DAO token contract, extends SIP-010 standard.
;; Used for governance and entrance-tax mechanism.
(define-trait token (
  (transfer
    (uint principal principal (optional (buff 34)))
    (response bool uint)
  )
))

;; Token management on behalf of the DAO.
;; Allows proposals to configure token properties.
(define-trait token-owner (
  (set-token-uri
    ((string-utf8 256))
    (response bool uint)
  )
  (transfer-ownership
    (principal)
    (response bool uint)
  )
))

;; ============================================================
;; EXTENSION TRAITS
;; ============================================================

;; Treasury extension for asset management.
;; Handles deposits, withdrawals, and asset allowlisting.
(define-trait treasury (
  (allow-asset
    (principal bool)
    (response bool uint)
  )
  (deposit-ft
    (<ft-trait> uint)
    (response bool uint)
  )
  (withdraw-ft
    (<ft-trait> uint principal)
    (response bool uint)
  )
))

;; Epoch tracking extension for time-based governance.
;; Used for voting windows, proposal timing, etc.
(define-trait dao-epoch (
  (get-current-dao-epoch
    ()
    (response uint uint)
  )
  (get-dao-epoch-length
    ()
    (response uint uint)
  )
))

;; Charter management for mission and values.
;; Stores the DAO's purpose and guiding principles on-chain.
(define-trait dao-charter (
  (set-dao-charter
    ((string-utf8 16384))
    (response bool uint)
  )
))

;; Generic proposal voting for core proposals.
;; Handles the full lifecycle of proposal voting.
(define-trait core-proposals (
  (create-proposal
    (<proposal> (optional (string-ascii 1024)))
    (response uint uint)
  )
  (vote-on-proposal
    (uint bool)
    (response bool uint)
  )
  (conclude-proposal
    (uint <proposal>)
    (response bool uint)
  )
  (get-proposal-data
    (uint)
    (response
      {
        proposal: principal,
        proposer: principal,
        created-at-block: uint,
        end-block: uint,
        votes-for: uint,
        votes-against: uint,
        concluded: bool,
        passed: bool
      }
      uint
    )
  )
))
