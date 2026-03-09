;; title: upgrade-to-free-floating
;; version: 1.0.0
;; summary: Phase 1 to Phase 2 upgrade with dissenter protection.
;; description: A 75% reputation-weighted vote to transition the DAO from pegged
;; (1:1 sBTC) to free-floating governance tokens. When passed:
;; - Yes-voters receive new free-floating governance tokens
;; - Dissenters (no-voters + non-voters) receive their sBTC back
;; - Guardian council is automatically dissolved
;; - Governance becomes pure token-weighted (1 token = 1 vote)

;; TRAITS
(impl-trait .dao-traits.extension)

;; CONSTANTS
(define-constant SELF (as-contract tx-sender))
(define-constant UPGRADE_THRESHOLD u7500) ;; 75% reputation-weighted
(define-constant BASIS_POINTS u10000)
(define-constant VOTING_PERIOD u432) ;; ~3 days in blocks

;; Error codes (6300 range)
(define-constant ERR_NOT_AUTHORIZED (err u6300))
(define-constant ERR_ALREADY_UPGRADED (err u6301))
(define-constant ERR_VOTE_ACTIVE (err u6302))
(define-constant ERR_NO_ACTIVE_VOTE (err u6303))
(define-constant ERR_ALREADY_VOTED (err u6304))
(define-constant ERR_VOTING_NOT_ENDED (err u6305))
(define-constant ERR_NOT_ELIGIBLE (err u6306))
(define-constant ERR_ALREADY_CLAIMED (err u6307))
(define-constant ERR_ZERO_BALANCE (err u6308))
(define-constant ERR_VOTE_FAILED (err u6309))

;; DATA VARS
(define-data-var upgraded bool false)
(define-data-var vote-active bool false)
(define-data-var vote-start-block uint u0)
(define-data-var vote-end-block uint u0)
(define-data-var rep-for uint u0)
(define-data-var rep-against uint u0)
(define-data-var total-rep-at-snapshot uint u0)
(define-data-var vote-passed bool false)

;; Snapshot of token supply and backing at vote conclusion
(define-data-var snapshot-supply uint u0)
(define-data-var snapshot-backing uint u0)

;; DATA MAPS

;; Track how each agent voted
(define-map Votes
  principal
  { in-favor: bool, reputation: uint }
)

;; Track who has claimed their outcome (tokens or sBTC refund)
(define-map Claimed principal bool)

;; ============================================================
;; EXTENSION CALLBACK
;; ============================================================

(define-public (callback (sender principal) (memo (buff 34)))
  (ok true)
)

;; ============================================================
;; START UPGRADE VOTE
;; ============================================================

;; Any DAO member with reputation can start the upgrade vote
(define-public (start-upgrade-vote)
  (let
    (
      (proposer tx-sender)
      (proposer-rep (contract-call? .guardian-council get-reputation proposer))
      (total-rep (contract-call? .guardian-council get-total-reputation))
    )
    (asserts! (not (var-get upgraded)) ERR_ALREADY_UPGRADED)
    (asserts! (not (var-get vote-active)) ERR_VOTE_ACTIVE)
    (asserts! (> proposer-rep u0) ERR_NOT_ELIGIBLE)
    (var-set vote-active true)
    (var-set vote-start-block stacks-block-height)
    (var-set vote-end-block (+ stacks-block-height VOTING_PERIOD))
    (var-set rep-for u0)
    (var-set rep-against u0)
    (var-set total-rep-at-snapshot total-rep)
    (print {
      notification: "upgrade/start-vote",
      payload: {
        proposer: proposer,
        end-block: (var-get vote-end-block),
        total-reputation: total-rep
      }
    })
    (ok true)
  )
)

;; ============================================================
;; CAST VOTE
;; ============================================================

;; Vote on the upgrade proposal (reputation-weighted)
(define-public (vote (in-favor bool))
  (let
    (
      (voter tx-sender)
      (voter-rep (contract-call? .guardian-council get-reputation voter))
    )
    (asserts! (var-get vote-active) ERR_NO_ACTIVE_VOTE)
    (asserts! (<= stacks-block-height (var-get vote-end-block)) ERR_VOTING_NOT_ENDED)
    (asserts! (> voter-rep u0) ERR_NOT_ELIGIBLE)
    (asserts! (is-none (map-get? Votes voter)) ERR_ALREADY_VOTED)
    ;; Record vote
    (map-set Votes voter { in-favor: in-favor, reputation: voter-rep })
    ;; Tally
    (if in-favor
      (var-set rep-for (+ (var-get rep-for) voter-rep))
      (var-set rep-against (+ (var-get rep-against) voter-rep))
    )
    (print {
      notification: "upgrade/vote",
      payload: {
        voter: voter,
        in-favor: in-favor,
        reputation: voter-rep,
        rep-for: (var-get rep-for),
        rep-against: (var-get rep-against)
      }
    })
    (ok true)
  )
)

;; ============================================================
;; CONCLUDE VOTE
;; ============================================================

;; Conclude the upgrade vote after voting period ends
(define-public (conclude-vote)
  (let
    (
      (total-rep (var-get total-rep-at-snapshot))
      (for-votes (var-get rep-for))
      ;; 75% of total reputation must vote in favor
      (passed (>= (* for-votes BASIS_POINTS) (* total-rep UPGRADE_THRESHOLD)))
      (current-supply (unwrap-panic (contract-call? .token-pegged get-total-supply)))
      (current-backing (contract-call? .token-pegged get-total-backing))
    )
    (asserts! (var-get vote-active) ERR_NO_ACTIVE_VOTE)
    (asserts! (> stacks-block-height (var-get vote-end-block)) ERR_VOTING_NOT_ENDED)
    ;; End the vote
    (var-set vote-active false)
    (var-set vote-passed passed)
    (if passed
      (begin
        ;; Snapshot current state for claim calculations
        (var-set snapshot-supply current-supply)
        (var-set snapshot-backing current-backing)
        ;; Mark as upgraded
        (var-set upgraded true)
        ;; Dissolve guardian council
        (try! (contract-call? .guardian-council dissolve))
        ;; Break the peg on the token
        (try! (contract-call? .token-pegged set-pegged false))
        (print {
          notification: "upgrade/concluded-passed",
          payload: {
            rep-for: for-votes,
            total-rep: total-rep,
            supply-snapshot: current-supply,
            backing-snapshot: current-backing
          }
        })
      )
      (print {
        notification: "upgrade/concluded-failed",
        payload: {
          rep-for: for-votes,
          total-rep: total-rep,
          supply-snapshot: u0,
          backing-snapshot: u0
        }
      })
    )
    (ok passed)
  )
)

;; ============================================================
;; CLAIM OUTCOME (post-vote)
;; ============================================================

;; Yes-voters: keep their tokens (now free-floating governance tokens)
;; No-voters / non-voters: burn tokens, receive pro-rata sBTC refund
(define-public (claim)
  (let
    (
      (claimer tx-sender)
      (balance (unwrap-panic (contract-call? .token-pegged get-balance claimer)))
      (vote-record (map-get? Votes claimer))
      (voted-yes (match vote-record
        record (get in-favor record)
        false ;; didn't vote = treated as dissenter
      ))
    )
    (asserts! (var-get upgraded) ERR_VOTE_FAILED)
    (asserts! (> balance u0) ERR_ZERO_BALANCE)
    (asserts! (is-none (map-get? Claimed claimer)) ERR_ALREADY_CLAIMED)
    ;; Mark as claimed
    (map-set Claimed claimer true)
    (if voted-yes
      ;; YES voters: tokens stay, they're now free-floating governance tokens
      (begin
        (print {
          notification: "upgrade/claim-tokens",
          payload: { agent: claimer, tokens: balance }
        })
        (ok balance)
      )
      ;; NO voters / non-voters: burn tokens, get sBTC back
      (let
        (
          (supply (var-get snapshot-supply))
          (backing (var-get snapshot-backing))
          ;; Pro-rata sBTC: (balance / snapshot-supply) * snapshot-backing
          (sbtc-refund (/ (* balance backing) supply))
        )
        ;; Burn their tokens
        (try! (contract-call? .token-pegged dao-burn balance claimer))
        ;; Send sBTC from token contract backing
        (try! (contract-call? .token-pegged withdraw-backing sbtc-refund claimer))
        (print {
          notification: "upgrade/claim-refund",
          payload: { agent: claimer, tokens-burned: balance, sbtc-refunded: sbtc-refund }
        })
        (ok sbtc-refund)
      )
    )
  )
)

;; ============================================================
;; READ-ONLY FUNCTIONS
;; ============================================================

(define-read-only (is-upgraded)
  (var-get upgraded)
)

(define-read-only (is-vote-active)
  (var-get vote-active)
)

(define-read-only (get-vote-data)
  {
    active: (var-get vote-active),
    start-block: (var-get vote-start-block),
    end-block: (var-get vote-end-block),
    rep-for: (var-get rep-for),
    rep-against: (var-get rep-against),
    total-rep: (var-get total-rep-at-snapshot),
    passed: (var-get vote-passed),
    upgraded: (var-get upgraded)
  }
)

(define-read-only (get-agent-vote (agent principal))
  (map-get? Votes agent)
)

(define-read-only (has-claimed (agent principal))
  (is-some (map-get? Claimed agent))
)

(define-read-only (get-dissenter-refund (agent principal))
  (let
    (
      (balance (unwrap-panic (contract-call? .token-pegged get-balance agent)))
      (supply (var-get snapshot-supply))
      (backing (var-get snapshot-backing))
    )
    (if (or (is-eq supply u0) (is-eq balance u0))
      u0
      (/ (* balance backing) supply)
    )
  )
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
