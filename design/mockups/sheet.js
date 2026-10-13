/*
 * PROPOSED membership sheet, design proposal v2 (docs/paywall/design/PROPOSAL.md, section V2), with the v2.1 changes
 * (section V2.1: per-opening plan reset, onClose before focus return, the success-step exits). NOT deployed and
 * NOT membership.js. Two parts:
 *
 *   1. BDSheet: the full-screen sheet controller (open, close, steps, history, scroll lock, focus, inert). It is
 *      written in membership.js's own style (ES5, no dependencies) so the build can port it unchanged; every
 *      behaviour in it is specified, with its reason, in PROPOSAL.md V2-1 .. V2-3.
 *   2. The mockup driver: opens a reader-facing state from #<state> for the renders, and wires a clickable mock
 *      flow (no request leaves the page; the card states mount Stripe's Payment Element in TEST mode only, when the
 *      page carries a pk_test_ key). Deployed strings it sets are copied from membership.js (lines cited).
 *
 * Journalism purpose: a reader who decides to pay gets one task on screen, on the article they came to read, and
 * every way out (X, Escape, Back) returns them to the same paragraph. Hell Gate and 404 Media (research 27/28) open
 * a new tab, ignore Escape on phones, ignore Back, and send the reader to stripe.com to pay; this does none of that.
 */
(function () {
  'use strict';
  var doc = document;

  function qs(sel, root) { return (root || doc).querySelector(sel); }
  function qsa(sel, root) { return Array.prototype.slice.call((root || doc).querySelectorAll(sel)); }
  function merge(a, b) { var o = {}, k; if (a && typeof a === 'object') { for (k in a) o[k] = a[k]; } for (k in b) o[k] = b[k]; return o; }
  function focusNoScroll(el) { if (!el) return; try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); } }

  /* ═══════════════════════════════ 1. BDSheet ═══════════════════════════════ */

  /**
   * root: the .bd-sheet element, a direct child of <body> (so every other body child can be made inert).
   * opts.onOpen(step)          v2.1: called once per NEW opening (not on in-sheet steps), before the first step shows.
   *                            The gate resets per-opening state here: the plan goes back to cfg.default_plan, monthly
   *                            (owner, 2026-10-13: "default should be monthly"; PROPOSAL.md V2.1-3).
   * opts.onStep(step)          called each time a step shows.
   * opts.onClose(reason, step) reason: 'x' | 'escape' | 'popstate' | 'done' | 'away'; step: the step it closed on.
   *                            v2.1: called BEFORE focus returns, so the gate can unlock the story first when the sheet
   *                            closes on the success step (every exit there = "Read the story", PROPOSAL.md V2.1-4).
   * opts.fallbackFocus()       where focus goes when the control that opened the sheet no longer exists (e.g. the gate
   *                            was replaced by the unlocked text)
   */
  function BDSheet(root, opts) {
    var self = this;
    this.root = root;
    this.opts = opts || {};
    this.scroller = qs('[data-bd-sheet-scroll]', root);
    this.backBtn = qs('[data-bd-sheet-back]', root);
    this.closeBtn = qs('[data-bd-sheet-close]', root);
    this.steps = {};
    qsa('[data-bd-sheet-step]', root).forEach(function (el) { self.steps[el.getAttribute('data-bd-sheet-step')] = el; });
    this.step = null;
    this.isOpen = false;
    this.busy = false;          // a payment is processing: X and Escape wait (V2-2); Back cannot be held
    this.pushed = false;
    this.ignorePop = false;
    this.trigger = null;
    this.lockY = 0;
    this.saved = null;
    this.inerted = [];
    this.onKey = this.onKey.bind(this);
    this.onPop = this.onPop.bind(this);
    this.backBtn.addEventListener('click', function () { self.back(); });
    this.closeBtn.addEventListener('click', function () { self.close('x'); });
    window.addEventListener('popstate', this.onPop);
  }

  BDSheet.prototype.open = function (step, trigger) {
    if (this.isOpen) { this.show(step); return; }
    this.isOpen = true;
    this.trigger = trigger || doc.activeElement;
    // V2-2: ONE history entry, no URL change (no #/portal/... hash). The entry is pushed BEFORE the scroll lock, so
    // the entry being left keeps the reader's scroll position.
    try { history.pushState(merge(history.state, { bdSheet: 1 }), ''); this.pushed = true; } catch (e) { this.pushed = false; }
    this.lock();
    this.inert(true);
    this.root.hidden = false;
    doc.addEventListener('keydown', this.onKey, true);
    if (this.opts.onOpen) this.opts.onOpen(step);           // v2.1: per-opening reset (plan = monthly)
    this.show(step);
    var root = this.root;
    // The opening transition (CSS; none under prefers-reduced-motion). Transform/opacity only: no layout shift.
    window.requestAnimationFrame(function () { window.requestAnimationFrame(function () { root.classList.add('is-open'); }); });
  };

  BDSheet.prototype.show = function (name, focus) {
    var el = this.steps[name];
    var self = this;
    if (!el) return;
    Object.keys(this.steps).forEach(function (k) { self.steps[k].hidden = (k !== name); });
    this.step = name;
    this.root.setAttribute('data-bd-sheet-at', name);
    var heading = qs('[data-bd-sheet-heading]', el);
    if (heading && heading.id) this.root.setAttribute('aria-labelledby', heading.id);   // the dialog's name = the step's
    this.backBtn.hidden = !el.getAttribute('data-bd-sheet-parent');                     // V2-2: Back = previous step
    if (this.scroller) this.scroller.scrollTop = 0;
    if (focus !== false) focusNoScroll(qs('[data-bd-sheet-focus]', el) || heading);
    if (this.opts.onStep) this.opts.onStep(name);
  };

  BDSheet.prototype.back = function () {
    if (this.busy) return;                  // v2.1: while a payment processes, "← Back" waits like X and Escape
    var el = this.steps[this.step];
    var parent = el && el.getAttribute('data-bd-sheet-parent');
    if (parent) this.show(parent);
  };

  BDSheet.prototype.setBusy = function (on) {
    this.busy = !!on;
    this.closeBtn.setAttribute('aria-disabled', on ? 'true' : 'false');
    this.backBtn.setAttribute('aria-disabled', on ? 'true' : 'false');   // v2.1
    this.root.classList.toggle('is-busy', !!on);
  };

  BDSheet.prototype.close = function (reason) {
    if (!this.isOpen) return;
    if (this.busy && (reason === 'x' || reason === 'escape')) return;
    this.isOpen = false;
    doc.removeEventListener('keydown', this.onKey, true);
    this.root.classList.remove('is-open');
    this.root.hidden = true;
    this.inert(false);
    this.unlock();
    // Consume the entry open() pushed, so the next Back leaves the article as the reader expects (one Back = one
    // thing). When the reader pressed Back themselves (popstate) the browser has already consumed it.
    if (reason !== 'popstate' && this.pushed && history.state && history.state.bdSheet) {
      this.ignorePop = true;
      history.back();
    }
    this.pushed = false;
    // v2.1: the gate hears the close BEFORE focus returns, with the step it closed on. Closing on the success step
    // unlocks the story there, and focus then lands in the story (the trigger no longer exists).
    if (this.opts.onClose) this.opts.onClose(reason, this.step);
    var t = this.trigger;
    this.trigger = null;
    var target = (t && doc.body.contains(t) && !(t.closest && t.closest('[inert]'))) ? t
      : (this.opts.fallbackFocus ? this.opts.fallbackFocus() : null);
    focusNoScroll(target);                                   // V2-2: focus returns without moving the page
  };

  BDSheet.prototype.onPop = function () {
    if (this.ignorePop) { this.ignorePop = false; return; }
    if (this.isOpen) this.close('popstate');               // V2-2: Back closes the sheet
  };

  BDSheet.prototype.onKey = function (e) {
    // V2-2: Escape closes on desktop and on hardware keyboards on phones and tablets. The listener is on the page's
    // own document (capture phase); nothing of the sheet's own UI is in an iframe, unlike Ghost Portal's (research
    // 27 F1). Key presses inside Stripe's card iframe stay inside that iframe (cross-origin) and do not close it.
    if (e.key === 'Escape' || e.key === 'Esc' || e.keyCode === 27) {
      e.preventDefault();
      this.close('escape');
    }
  };

  // V2-2: the iOS-robust scroll lock. The body is fixed at minus the scroll offset, so the page cannot scroll
  // under the sheet whatever the engine does with overflow on <body>, and the offset is restored exactly on close.
  BDSheet.prototype.lock = function () {
    var de = doc.documentElement, s = doc.body.style;
    this.lockY = window.pageYOffset || de.scrollTop || 0;
    var gutter = window.innerWidth - de.clientWidth;          // a classic scrollbar's width (0 with overlay bars)
    this.saved = { position: s.position, top: s.top, left: s.left, right: s.right, width: s.width,
                   overflow: s.overflow, paddingRight: s.paddingRight };
    try { this.savedRestoration = history.scrollRestoration; history.scrollRestoration = 'manual'; } catch (e) { /* old */ }
    s.position = 'fixed';
    s.top = (-this.lockY) + 'px';
    s.left = '0';
    s.right = '0';
    s.width = '100%';
    s.overflow = 'hidden';
    if (gutter > 0) s.paddingRight = gutter + 'px';            // no sideways jump when the scrollbar disappears
    de.classList.add('bd-sheet-locked');
  };

  BDSheet.prototype.unlock = function () {
    var de = doc.documentElement, s = doc.body.style, k;
    for (k in this.saved) { if (Object.prototype.hasOwnProperty.call(this.saved, k)) s[k] = this.saved[k]; }
    de.classList.remove('bd-sheet-locked');
    // The site animates scrolling (overflow-fix.css:564 html {scroll-behavior: smooth}); the restore must be instant.
    var prev = de.style.scrollBehavior;
    de.style.scrollBehavior = 'auto';
    window.scrollTo(0, this.lockY);
    de.style.scrollBehavior = prev;
    try { if (this.savedRestoration) history.scrollRestoration = this.savedRestoration; } catch (e) { /* old */ }
  };

  // V2-2: every other child of <body> is inert while the sheet is open (no focus, no clicks, hidden from assistive
  // technology). Elements added to <body> AFTER opening are left alone: Stripe's 3-D Secure modal is one of them
  // (PROPOSAL.md V2-2 says why the sheet is not a showModal() <dialog>).
  BDSheet.prototype.inert = function (on) {
    var self = this;
    if (on) {
      this.inerted = [];
      Array.prototype.forEach.call(doc.body.children, function (el) {
        if (el === self.root || el.hasAttribute('inert') || /^(SCRIPT|TEMPLATE|STYLE|LINK)$/.test(el.tagName)) return;
        el.setAttribute('inert', '');
        self.inerted.push(el);
      });
    } else {
      this.inerted.forEach(function (el) { el.removeAttribute('inert'); });
      this.inerted = [];
    }
  };

  window.BDSheet = BDSheet;

  /* ═══════════════════════════════ 2. mockup driver ═══════════════════════════════ */

  var gate = qs('[data-bd-gate]');
  var sheetEl = qs('#bd-sheet');
  if (!gate || !sheetEl) return;

  var STATE = (location.hash || '#arrive').slice(1);
  var cfg = JSON.parse(qs('#bd-gate-config').textContent);
  var body = qs('.bd-gate--sheet', sheetEl);
  var READER = 'reader@example.com', MEMBER = 'member@example.com';
  var reader = READER, optIn = true, signedIn = false, planKey = cfg.default_plan || 'monthly';
  var doneTimer = null;

  function plan(key) { return cfg.plans.filter(function (p) { return p.key === key; })[0]; }
  function money(cents, short) {                                    // membership.js:77-87
    var whole = Math.floor(cents / 100), frac = cents % 100;
    return '$' + whole + ((short && frac === 0) ? '' : '.' + (frac < 10 ? '0' : '') + frac);
  }
  function text(sel, t, root) { qsa(sel, root || doc).forEach(function (el) { el.textContent = t; }); }

  var sheet = new BDSheet(sheetEl, {
    fallbackFocus: function () {
      var t = qs('.bd-paywalled > *');
      if (t && !t.hasAttribute('tabindex')) t.setAttribute('tabindex', '-1');
      return t || qs('#bd-gate-email');
    },
    // v2.1-3 (owner, 2026-10-13: "default should be monthly"): every NEW opening starts on the default plan, whatever
    // the radios hold (a browser can restore a radio the reader set earlier: measured in Chromium, PROPOSAL.md
    // V2.1-3). Inside one opening the reader's own choice is kept: "Change" and "← Back" from payment show it.
    onOpen: function () { selectPlan(cfg.default_plan || 'monthly'); },
    onStep: function (name) {
      if (name === 'pay') startPay();
    },
    // v2.1-4: on the success step every exit (X, Escape, Back) does what "Read the story" does: the story unlocks in
    // place. v2 left the story locked when the reader closed the success screen with X (the mock unlocked only in
    // finish()). After a "Read the story" (reason 'done') the story is already unlocked.
    onClose: function (reason, step) {
      if (step !== 'success') return;
      window.clearTimeout(doneTimer);
      if (doc.body.contains(gate)) unlock(true);
    }
  });
  window.__bdSheet = sheet;                                         // for verify_sheet.py

  /* the plan switch drives the card, the summary, the disclosure and the submit label */
  function selectPlan(key) {
    planKey = key;
    var p = plan(key), m = plan('monthly');
    qsa('.bd-cadence__input', sheetEl).forEach(function (i) { i.checked = (i.value === key); });
    text('[data-bd-offer-amount]', money(p.amount_cents, key === 'annual'), sheetEl);
    text('[data-bd-offer-per]', '/' + p.interval, sheetEl);
    text('[data-bd-offer-basis]', key === 'annual'
      ? 'Save ' + money(12 * m.amount_cents - p.amount_cents) + ' vs. 12 monthly payments. Cancel anytime online.'
      : 'Billed every month. Cancel anytime online.', sheetEl);
    text('[data-bd-summary-plan]', p.name + ' membership', sheetEl);
    text('[data-bd-summary-price]', money(p.amount_cents) + ' a ' + p.interval, sheetEl);
    text('#bd-gate-disclosure', cfg.disclosures[key], sheetEl);                         // membership.js:92-95
    text('#bd-gate-submit', 'Subscribe for ' + money(p.amount_cents) + ' a ' + p.interval, sheetEl);   // :96-98
  }
  qsa('.bd-cadence__input', sheetEl).forEach(function (i) {
    i.addEventListener('change', function () { if (i.checked) selectPlan(i.value); });
  });

  function setReader(email) {
    reader = email;
    text('[data-bd-step-email]', email, sheetEl);
    text('[data-bd-sent-to]', email, sheetEl);
  }
  function setSignedIn(email) {
    signedIn = true;
    setReader(email);
    text('[data-bd-account-email]', email);
    qsa('[data-bd-signed-in-prefix], [data-bd-signed-in]', sheetEl).forEach(function (el) { el.hidden = false; });
    qsa('[data-bd-signed-out]', sheetEl).forEach(function (el) { el.hidden = true; });
    // The newsletter line is shown only to a reader who asked for the newsletter (sales/clock.py newsletter_perk):
    // `me` does not return list status today (membership/app.py:358-384), so a signed-in reader does not see it.
    qsa('[data-bd-offer-newsletter]', sheetEl).forEach(function (el) { el.hidden = true; });
    // The card: variant C headline and the signed-in line, "See plans"; no auto-open (owner, 2026-10-13).
    qs('#bd-gate-title', gate).innerHTML = 'You’re out of <em>free articles.</em>';
    qsa('[data-bd-step]', gate).forEach(function (el) { el.hidden = el.getAttribute('data-bd-step') !== 'member'; });
  }

  /* wallets: headless browsers have no Apple Pay; a labelled stand-in of Stripe's black button */
  function wallets(w) {
    body.setAttribute('data-bd-wallets', w);
    var slot = qs('#bd-gate-express', sheetEl), toggle = qs('#bd-gate-card-toggle', sheetEl);
    slot.removeAttribute('aria-busy');
    if (w === 'none') {
      slot.setAttribute('data-state', 'none');
      toggle.textContent = 'Pay with card';
    } else {
      slot.setAttribute('data-state', 'ready');
      qs('#bd-gate-express-mount', sheetEl).innerHTML =
        '<div class="mock-wallet" role="img" aria-label="Stand-in for Stripe’s black Apple Pay button">' +
        '<span>Subscribe with</span><b> Pay</b></div>';
      toggle.textContent = 'Pay with card';
    }
  }
  var walletMode = 'applePay';
  function startPay() {
    if (body.getAttribute('data-bd-wallets') !== 'pending') return;
    wallets(walletMode);
    if (walletMode === 'none') openCard();     // V2-3: with no wallet button the card form is the only path: open it
  }
  function openCard() {
    var t = qs('#bd-gate-card-toggle', sheetEl), panel = qs('#bd-gate-card-panel', sheetEl);
    t.setAttribute('aria-expanded', 'true');
    panel.hidden = false;
    mountStripe();
  }
  qs('#bd-gate-card-toggle', sheetEl).addEventListener('click', function () {
    var open = this.getAttribute('aria-expanded') === 'true';
    if (open) { this.setAttribute('aria-expanded', 'false'); qs('#bd-gate-card-panel', sheetEl).hidden = true; }
    else openCard();
  });

  function consentError(on) {
    var box = qs('.bd-gate__consent', sheetEl);
    box.classList.toggle('has-error', on);
    qs('#bd-gate-consent', sheetEl).setAttribute('aria-invalid', on ? 'true' : 'false');
    text('#bd-gate-consent-error', on ? 'Check the box to agree to the membership terms before paying.' : '', sheetEl); // membership.js:805
  }
  qs('#bd-gate-consent', sheetEl).addEventListener('change', function () { if (this.checked) consentError(false); });

  /* S1 in the card: Continue opens the sheet (mock: an address starting "member" has a membership -> code) */
  qs('#bd-gate-start', gate).addEventListener('submit', function (e) {
    e.preventDefault();
    var input = qs('#bd-gate-email', gate), btn = qs('#bd-gate-continue', gate);
    var v = input.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
      input.setAttribute('aria-invalid', 'true');
      text('#bd-gate-email-error', 'Enter an email address, like name@example.com.', gate);   // membership.js:571
      input.focus();
      return;
    }
    input.removeAttribute('aria-invalid');
    text('#bd-gate-email-error', '', gate);
    optIn = qs('#bd-gate-newsletter', gate).checked;
    qsa('[data-bd-offer-newsletter]', sheetEl).forEach(function (el) { el.hidden = !optIn; });
    btn.textContent = 'Checking…';                                              // membership.js:584
    btn.setAttribute('aria-busy', 'true');
    window.setTimeout(function () {
      btn.textContent = 'Continue';
      btn.removeAttribute('aria-busy');
      setReader(v);
      // The sheet opens only once the answer is known (code or plans): never an empty sheet.
      sheet.open(/^member/i.test(v) ? 'code' : 'plans', btn);
    }, 350);
  });
  qs('[data-bd-see-plans]', gate).addEventListener('click', function () { sheet.open('plans', this); });

  /* in-sheet navigation */
  qsa('[data-bd-sheet-next], [data-bd-sheet-goto]', sheetEl).forEach(function (el) {
    el.addEventListener('click', function (e) {
      e.preventDefault();
      if (sheet.busy) return;                 // v2.1: "Change" and the terms link wait while a payment processes
      sheet.show(el.getAttribute('data-bd-sheet-next') || el.getAttribute('data-bd-sheet-goto'));
    });
  });
  qsa('[data-bd-change-email]', sheetEl).forEach(function (el) {   // S2a "Use a different email": back to S1
    el.addEventListener('click', function () {
      sheet.close('away');
      var i = qs('#bd-gate-email', gate);
      focusNoScroll(i);
      try { i.select(); } catch (e) { /* not selectable */ }
    });
  });

  /* S2a: any code but the mock's "wrong" one signs the member in; the sheet closes and the story opens in place */
  qs('form[data-bd-signin-verify]', qs('[data-bd-sheet-step="code"]', sheetEl)).addEventListener('submit', function (e) {
    e.preventDefault();
    var code = qs('#bd-gate-code', sheetEl);
    if (code.value === '123465' || !/^\d{6}$/.test(code.value)) {
      code.setAttribute('aria-invalid', 'true');
      text('#bd-gate-code-error', 'That code is wrong or has expired.', sheetEl);        // membership/app.py:484
      code.focus();
      return;
    }
    sheet.close('done');
    unlock(false);
  });

  /* payment (mock): consent first, then "processing", then the success screen */
  function processing(on) {
    var btn = qs('#bd-gate-submit', sheetEl);
    sheet.setBusy(on);
    body.setAttribute('data-bd-state', on ? 'processing' : 'idle');             // membership.js setState (:1087)
    if (on) {
      btn.setAttribute('aria-busy', 'true');
      btn.textContent = 'Processing…';                                          // membership.js:1089
      text('#bd-gate-progress', 'Starting your membership…', sheetEl);            // membership.js:1090
    } else {
      btn.removeAttribute('aria-busy');
      selectPlan(planKey);
      text('#bd-gate-progress', '', sheetEl);
    }
  }
  qs('#bd-gate-join', sheetEl).addEventListener('submit', function (e) {
    e.preventDefault();
    if (!qs('#bd-gate-consent', sheetEl).checked) { consentError(true); qs('#bd-gate-consent', sheetEl).focus(); return; }
    processing(true);
    window.setTimeout(function () {
      processing(false);
      success(true);
    }, 900);
  });

  function success(autoClose) {
    sheet.show('success');
    if (!autoClose) return;
    // V2-1, kept by the owner (2026-10-13: "auto closing the message makes sense"): the success screen stays up for 2 s,
    // then the sheet closes by itself; "Keep reading", X, Escape or Back close it sooner. Every exit unlocks in place.
    window.clearTimeout(doneTimer);
    doneTimer = window.setTimeout(function () { finish(); }, 2000);
  }
  function finish() {
    window.clearTimeout(doneTimer);
    if (!sheet.isOpen) return;
    unlock(true);             // the story is in place first, so focus has somewhere to go
    sheet.close('done');
  }
  qs('[data-bd-sheet-done]', sheetEl).addEventListener('click', finish);

  /* the article unlocks in place (membership.js Gate.prototype.unlock: the gate is replaced by the text) */
  function unlock(paid) {
    var tpl = qs('#bd-unlocked-template');
    var frag = doc.createElement('div');
    frag.innerHTML = tpl ? tpl.innerHTML : '';
    if (!paid) { var note = qs('.bd-unlock-note', frag); if (note) note.parentNode.removeChild(note); }   // G-11
    gate.replaceWith.apply(gate, Array.prototype.slice.call(frag.childNodes));
  }

  /* ───────── states for the renders (#<state>) ───────── */
  function landAtGate() {
    // the reader has scrolled to the gate: the card sits at about 62% of the viewport (same rule as render_mockups)
    var top = gate.getBoundingClientRect().top + window.pageYOffset;
    window.scrollTo(0, Math.max(0, top - window.innerHeight * 0.62));
  }
  function payState(w) { walletMode = w; selectPlan(planKey); sheet.open('plans'); sheet.show('pay'); }

  var S = {
    'arrive': function () {},
    's1': function () {},
    's1-invalid': function () {
      qs('#bd-gate-email', gate).value = 'reader@example';
      qs('#bd-gate-email', gate).setAttribute('aria-invalid', 'true');
      text('#bd-gate-email-error', 'Enter an email address, like name@example.com.', gate);
    },
    // v2.1 flow states (FLOW.md, path D): gate/start failed on the network. MSG_NETWORK (membership.js:40) shows under
    // the field (:600); decision V2.1-5: the field is NOT marked invalid, because the address is not wrong.
    's1-network': function () {
      qs('#bd-gate-email', gate).value = READER;
      text('#bd-gate-email-error', 'We could not reach Bushwick Daily. Check your connection and try again.', gate);
    },
    // v2.1 flow state (FLOW.md, path E): the reader typed an address, the sheet opened, and they closed it with X.
    'returned': function () {
      var input = qs('#bd-gate-email', gate);
      input.value = READER;
      setReader(READER);
      landAtGate();
      sheet.open('plans', qs('#bd-gate-continue', gate));
      sheet.close('x');
    },
    'signed-in': function () { setSignedIn(READER); },
    'jump-note': function () { text('[data-bd-gate-jump-note]', '“The Switches” is in the members-only part of this story.', gate); }, // membership.js:1381
    'sheet-code': function () { setReader(MEMBER); sheet.open('code'); },
    'sheet-code-wrong': function () {
      setReader(MEMBER); sheet.open('code');
      var c = qs('#bd-gate-code', sheetEl); c.value = '123465'; c.setAttribute('aria-invalid', 'true');
      text('#bd-gate-code-error', 'That code is wrong or has expired.', sheetEl);
    },
    'sheet-plans': function () { setReader(READER); sheet.open('plans'); },
    // the reader tapped Yearly (the sheet always opens on Monthly, so the choice is made after opening)
    'sheet-plans-yearly': function () { setReader(READER); sheet.open('plans'); selectPlan('annual'); },
    'sheet-plans-signed-in': function () { setSignedIn(READER); sheet.open('plans'); },
    'sheet-signin': function () { setReader(READER); sheet.open('plans'); sheet.show('signin'); },
    'sheet-pay': function () { setReader(READER); payState('applePay'); },
    'sheet-pay-card': function () { setReader(READER); payState('none'); },
    'sheet-pay-consent-error': function () { setReader(READER); payState('none'); consentError(true); },
    'sheet-pay-card-errors': function () {
      window.__bdSubmitEmpty = true; setReader(READER); qs('#bd-gate-consent', sheetEl).checked = true; payState('none');
    },
    'sheet-pay-declined': function () {
      setReader(READER); qs('#bd-gate-consent', sheetEl).checked = true; payState('none');
      // Stripe's message for a declined test card (card_declined / generic_decline); membership.js:1136 shows it as is.
      text('#bd-gate-alert', 'Your card was declined.', sheetEl);
    },
    // v2.1 flow states (FLOW.md): the payment is running (X and Escape wait, V2-2); and checkout/subscribe failed on
    // the network (MSG_NETWORK, membership.js:40, written by fail() under Subscribe, :1099).
    'sheet-pay-processing': function () {
      setReader(READER); qs('#bd-gate-consent', sheetEl).checked = true; payState('none'); processing(true);
    },
    'sheet-pay-network': function () {
      setReader(READER); qs('#bd-gate-consent', sheetEl).checked = true; payState('none');
      text('#bd-gate-alert', 'We could not reach Bushwick Daily. Check your connection and try again.', sheetEl);
    },
    'sheet-terms': function () { setReader(READER); payState('applePay'); sheet.show('terms'); },
    'sheet-success': function () { setReader(READER); selectPlan(planKey); sheet.open('plans'); success(false); },
    'unlocked': function () { setReader(READER); unlock(true); },
    // v2.1 flow state (FLOW.md, path B): a member's code was right; the story opens with no receipt line (G-11).
    'unlocked-member': function () { setReader(MEMBER); unlock(false); }
  };
  setReader(READER);
  selectPlan(planKey);
  if (/^sheet-/.test(STATE) || /^unlocked/.test(STATE)) landAtGate();
  (S[STATE] || S.arrive)();
  doc.documentElement.setAttribute('data-mock-state', STATE);

  /* Stripe Payment Element, TEST mode, with the Appearance the page declares (window.BD_APPEARANCE). Same Elements
     options as membership.js ensureStripe/mountPaymentElement (:819-841, :1038-1063). */
  function mountStripe() {
    var key = doc.documentElement.getAttribute('data-stripe-test-key');
    var mount = qs('#bd-gate-payment-element', sheetEl);
    if (!key || !/^pk_test_/.test(key) || !mount || mount.getAttribute('data-state') === 'ready') return;
    mount.setAttribute('data-state', 'loading');
    var s = doc.createElement('script');
    s.src = 'https://js.stripe.com/v3/';
    s.onload = function () {
      var stripe = window.Stripe(key);
      var p = plan(planKey);
      var opts = { mode: 'subscription', amount: p.amount_cents, currency: 'usd', allowedPaymentMethodTypes: ['card', 'link'],
                   appearance: window.BD_APPEARANCE || {} };
      if (window.BD_STRIPE_FONTS) opts.fonts = window.BD_STRIPE_FONTS;
      var elements = stripe.elements(opts);
      var pe = elements.create('payment', { layout: 'tabs', wallets: { applePay: 'never', googlePay: 'never', link: 'never' },
                                            fields: { billingDetails: { email: 'never' } } });
      pe.on('ready', function () {
        mount.setAttribute('data-state', 'ready');
        doc.documentElement.setAttribute('data-stripe-ready', '1');
        if (window.__bdSubmitEmpty) elements.submit().then(function () {
          setTimeout(function () { doc.documentElement.setAttribute('data-stripe-errors', '1'); }, 600);
        });
      });
      pe.mount(mount);
    };
    doc.head.appendChild(s);
  }
})();
