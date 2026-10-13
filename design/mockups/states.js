/*
 * Mockup state switcher (design proposal only; NOT membership.js). Opening a mockup with #<state> shows that
 * reader-facing state by toggling the same hooks membership.js toggles (hidden steps, data-bd-wallets, texts).
 * Every message string is copied from the deployed code: wordpress/mu-plugins/bd-membership/assets/membership.js
 * (lines cited) or membership/app.py. Example addresses are example.com. No request is made by this file; the
 * card states mount Stripe's Payment Element in TEST mode when the page sets data-stripe-test-key (render script).
 */
(function () {
  'use strict';
  var STATE = (location.hash || '#s1').slice(1);
  window.addEventListener('hashchange', function () { location.reload(); });
  function qs(s, r) { return (r || document).querySelector(s); }
  function qsa(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function text(sel, t, r) { qsa(sel, r).forEach(function (el) { el.textContent = t; }); }

  var READER = 'r…@example.com', MEMBER = 'm…@example.com', MASKED = 'r***@example.com';
  var RENEWS = 'November 13, 2026';

  /* ───────────── gate ───────────── */
  var gate = qs('[data-bd-gate]');
  if (gate) {
    var cfg = JSON.parse(qs('#bd-gate-config').textContent);
    var step = function (name) {
      qsa('[data-bd-step]', gate).forEach(function (el) { el.hidden = el.getAttribute('data-bd-step') !== name; });
      gate.setAttribute('data-bd-gate-step', name);
    };
    var wallets = function (w) {
      gate.setAttribute('data-bd-wallets', w);
      var slot = qs('#bd-gate-express', gate), toggle = qs('#bd-gate-card-toggle', gate);
      if (!slot) return;
      slot.removeAttribute('aria-busy');
      if (w === 'none') { slot.setAttribute('data-state', 'none'); toggle.textContent = 'Pay with card'; }
      else {
        slot.setAttribute('data-state', 'ready');
        // Not Stripe's button: headless Chromium has no Apple Pay. A labelled stand-in of Stripe's black
        // Express Checkout button (buttonType "subscribe", buttonTheme "black", buttonHeight 48; membership.js:882-884).
        qs('#bd-gate-express-mount', gate).innerHTML =
          '<div class="mock-wallet" role="img" aria-label="Stand-in for Stripe\'s Apple Pay button">' +
          '<span>Subscribe with</span><b> Pay</b></div>';
        toggle.textContent = 'Pay with card instead';                      // membership.js:936
      }
    };
    var plan = function (key) {
      var p = cfg.plans.filter(function (x) { return x.key === key; })[0];
      qsa('.bd-plan', gate).forEach(function (l) {
        var on = l.getAttribute('data-bd-plan') === key;
        l.classList.toggle('is-selected', on);
        qs('input', l).checked = on;
      });
      text('#bd-gate-disclosure', cfg.disclosures[key], gate);
      var dollars = '$' + (p.amount_cents / 100).toFixed(2);
      text('#bd-gate-submit', 'Subscribe for ' + dollars + ' a ' + p.interval, gate); // membership.js:88-89
    };
    var openCard = function () {
      var t = qs('#bd-gate-card-toggle', gate), panel = qs('#bd-gate-card-panel', gate);
      t.setAttribute('aria-expanded', 'true'); panel.hidden = false;
      mountStripe();
    };
    var setErr = function (inputSel, errSel, msg) {
      var i = qs(inputSel, gate); if (i) i.setAttribute('aria-invalid', 'true');
      text(errSel, msg, gate);
    };
    var plans = function () {
      step('plans'); text('[data-bd-step-email]', READER, gate);
    };

    text('[data-bd-sent-to]', MEMBER, gate);
    var S = {
      'arrive': function () {},
      's1': function () {},
      's1-invalid': function () {
        qs('#bd-gate-email', gate).value = 'reader@example';
        setErr('#bd-gate-email', '#bd-gate-email-error', 'Enter an email address, like name@example.com.'); // membership.js:560
      },
      's2a': function () { step('code'); },
      's2a-wrong': function () {
        step('code'); qs('#bd-gate-code', gate).value = '123465';
        setErr('#bd-gate-code', '#bd-gate-code-error', 'That code is wrong or has expired.');   // membership/app.py:451
      },
      's2b': function () { plans(); wallets('none'); },
      's2b-yearly': function () { plans(); wallets('none'); plan('annual'); },
      's2b-wallet': function () { plans(); wallets('applePay'); },
      's2b-card': function () { plans(); wallets('none'); openCard(); },
      's2b-consent-error': function () {
        plans(); wallets('none'); openCard();
        qs('.bd-gate__consent', gate).classList.add('has-error');
        text('#bd-gate-consent-error', 'Check the box to agree to the membership terms before paying.', gate); // membership.js:1058
      },
      's2b-card-errors': function () { window.__bdSubmitEmpty = true; plans(); wallets('none'); qs('#bd-gate-consent', gate).checked = true; openCard(); },
      's2b-declined': function () {
        plans(); wallets('none'); qs('#bd-gate-consent', gate).checked = true; openCard();
        // Stripe's message for a declined test card (card_declined, generic_decline); membership.js:1125 shows it as is.
        text('#bd-gate-alert', 'Your card was declined.', gate);
      },
      'free-account': function () {
        plans(); wallets('none');
        var note = qs('[data-bd-no-membership]', gate); if (note) note.hidden = false;
        qsa('[data-bd-signed-out]', gate).forEach(function (el) { el.hidden = true; });       // membership.js:1331
        qsa('[data-bd-signed-in]', gate).forEach(function (el) { el.hidden = false; });
        text('[data-bd-email-masked]', MASKED, gate);
      },
      'jump-note': function () { text('[data-bd-gate-jump-note]', '“The Switches” is in the members-only part of this story.', gate); }, // membership.js:1362
      'unlocked': function () {
        var tpl = qs('#bd-unlocked-template');
        var frag = document.createElement('div');
        frag.innerHTML = tpl ? tpl.innerHTML : '';
        gate.replaceWith.apply(gate, Array.prototype.slice.call(frag.childNodes));
      }
    };
    (S[STATE] || S.s1)();
    document.documentElement.setAttribute('data-mock-state', STATE);
  }

  /* Stripe Payment Element, TEST mode, with the appearance the page declares (window.BD_APPEARANCE). */
  function mountStripe() {
    var key = document.documentElement.getAttribute('data-stripe-test-key');
    var mount = qs('#bd-gate-payment-element');
    if (!key || !/^pk_test_/.test(key) || !mount) { if (mount) mount.setAttribute('data-state', 'loading'); return; }
    var s = document.createElement('script');
    s.src = 'https://js.stripe.com/v3/';
    s.onload = function () {
      var stripe = window.Stripe(key);
      // Same Elements options as membership.js:815-824 (allowlist card + link), appearance from the page.
      var opts = { mode: 'subscription', amount: 699, currency: 'usd', allowedPaymentMethodTypes: ['card', 'link'],
                   appearance: window.BD_APPEARANCE || {} };
      if (window.BD_STRIPE_FONTS) opts.fonts = window.BD_STRIPE_FONTS;
      var elements = stripe.elements(opts);
      var pe = elements.create('payment', { layout: 'tabs', wallets: { applePay: 'never', googlePay: 'never', link: 'never' },
                                            fields: { billingDetails: { email: 'never' } } });
      pe.on('ready', function () {
        document.documentElement.setAttribute('data-stripe-ready', '1');
        if (window.__bdSubmitEmpty) elements.submit().then(function () {
          setTimeout(function () { document.documentElement.setAttribute('data-stripe-errors', '1'); }, 600);
        });
      });
      pe.mount(mount);
    };
    document.head.appendChild(s);
  }

  /* ───────────── /account/ ───────────── */
  var acct = qs('[data-bd-account]');
  if (acct) {
    var view = function (name) {
      qsa('[data-bd-view]', acct).forEach(function (el) { el.hidden = el.getAttribute('data-bd-view') !== name; });
      var st = qs('#bd-account-status', acct); if (st) { st.removeAttribute('data-bd-loading'); st.textContent = ''; }
    };
    var signinCode = function () {
      var req = qs('[data-bd-signin-request]', acct), ver = qs('[data-bd-signin-verify]', acct);
      req.hidden = true; ver.hidden = false; text('[data-bd-sent-to]', READER, acct);
    };
    var paid = function (canceling) {
      view('paid');
      text('[data-bd-email-masked]', MASKED, acct);
      text('[data-bd-plan-name]', 'Monthly', acct);                       // membership.js:1546
      text('[data-bd-plan-amount]', '$6.99 a month', acct);
      text('[data-bd-renew-label]', canceling ? 'Access until' : 'Renews on', acct);
      text('[data-bd-renew-date]', RENEWS, acct);
      text('[data-bd-period-end]', RENEWS, acct);
      text('[data-bd-access-until]', RENEWS, acct);
      var note = qs('[data-bd-canceling-note]', acct); if (note) note.hidden = !canceling;
      var start = qs('[data-bd-cancel-start]', acct); if (start) start.hidden = canceling;
      var resume = qs('[data-bd-resume]', acct); if (resume) resume.hidden = !canceling;
    };
    var A = {
      'signed-out': function () { view('signed-out'); },
      'code-sent': function () { view('signed-out'); signinCode(); },
      'link-expired': function () {
        view('signed-out');
        text('#bd-account-status', 'This sign-in link has expired or was already used. Enter your email to get a new one.', acct); // membership.js:1476
      },
      'paid': function () { paid(false); },
      'cancel-confirm': function () {
        paid(false);
        var box = qs('[data-bd-cancel-confirm]', acct); if (box) box.hidden = false;
        var start = qs('[data-bd-cancel-start]', acct); if (start) start.setAttribute('aria-expanded', 'true');
      },
      'canceled': function () {
        paid(true);
        text('#bd-account-status', 'Your membership is canceled. You keep access until ' + RENEWS + '.', acct); // membership.js:1585
      },
      'free': function () {
        view('free'); text('[data-bd-email-masked]', MASKED, acct);
        var nojoin = qs('[data-bd-join-none]', acct); if (nojoin) nojoin.hidden = false;
      },
      'comp': function () {
        view('comp'); text('[data-bd-email-masked]', MASKED, acct);
        var line = qs('[data-bd-comp-line]', acct); if (line) line.hidden = false;
        text('[data-bd-comp-until]', 'December 31, 2026', acct);
      }
    };
    (A[STATE] || A['signed-out'])();
    document.documentElement.setAttribute('data-mock-state', STATE);
  }
})();
