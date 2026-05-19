import { describe, it, expect } from 'vitest';
import { CRISIS_RE, detectCrisis } from '../src/crisis';

// ─── CRISIS_RE — the EN matcher, exported for back-compat ─────────────────────

describe('CRISIS_RE (EN matcher)', () => {
  it('matches "kill myself"', () => {
    expect(CRISIS_RE.test('i want to kill myself')).toBe(true);
  });

  it('matches "suicide" and variants', () => {
    expect(CRISIS_RE.test('thinking about suicide')).toBe(true);
    expect(CRISIS_RE.test('suicidal thoughts keep coming')).toBe(true);
    expect(CRISIS_RE.test('suicidality is exhausting')).toBe(true);
  });

  it('matches "end my life" / "end it"', () => {
    expect(CRISIS_RE.test('i want to end my life')).toBe(true);
    expect(CRISIS_RE.test('i just want to end it')).toBe(true);
  });

  it('matches "self-harm" and variants', () => {
    expect(CRISIS_RE.test('struggling with self-harm')).toBe(true);
    expect(CRISIS_RE.test('self harm urges')).toBe(true);
    expect(CRISIS_RE.test('selfharm')).toBe(true);
  });

  it('does NOT match benign uses of "kill" / "dead"', () => {
    expect(CRISIS_RE.test('kill it on the dance floor')).toBe(false);
    expect(CRISIS_RE.test('this code is so dead')).toBe(false);
    expect(CRISIS_RE.test('my computer is killing me')).toBe(false);
  });

  it('does NOT match empty string', () => {
    expect(CRISIS_RE.test('')).toBe(false);
  });
});

// ─── detectCrisis — English ───────────────────────────────────────────────────

describe('detectCrisis — English ideation', () => {
  it('matches direct ideation phrases', () => {
    for (const t of [
      'i want to die',
      'i wanna die',
      "i can't take it anymore",
      'i want to kill myself',
      "i don't want to be here",
      "i don't want to live",
      'thinking about hurting myself',
      'i keep harming myself',
      'i feel better off dead',
      'no reason to live anymore',
    ]) {
      expect(detectCrisis(t).match, t).toBe(true);
    }
  });

  it('returns lang "en" by default and honors the locale hint', () => {
    expect(detectCrisis('i want to die').lang).toBe('en');
    expect(detectCrisis('i want to die', 'es').lang).toBe('es');
  });
});

describe('detectCrisis — English method-seeking', () => {
  it('matches method-seeking phrasing', () => {
    for (const t of [
      'how can i kill myself in the most painless way',
      'what is the painless way to die',
      'least painful way to die',
      'whats the easiest way to die',
      'how to die',
      'ways to die quietly',
      'how do i die',
      'what is the least painful way to end my life',
    ]) {
      expect(detectCrisis(t).match, t).toBe(true);
    }
  });

  it('does NOT match benign text', () => {
    expect(detectCrisis('had a rough day, everything is killing my vibe').match).toBe(false);
    expect(detectCrisis('great way to go about it').match).toBe(false);
    expect(detectCrisis('i could kill for a coffee').match).toBe(false);
  });
});

// ─── detectCrisis — Spanish ───────────────────────────────────────────────────

describe('detectCrisis — Spanish', () => {
  it('matches ideation phrases', () => {
    for (const t of [
      'hoy solo quiero morir',
      'me quiero morir',
      'quiero matarme',
      'me quiero matar',
      'pienso en quitarme la vida',
      'quiero acabar con mi vida',
      'voy a terminar con mi vida',
      'ya no quiero vivir',
      'estaría mejor muerto',
      'quiero hacerme daño',
      'quiero hacerme dano',
      'no aguanto más',
      'no aguanto mas',
      'pensamientos de autolesión',
      'pensamientos de autolesion',
    ]) {
      expect(detectCrisis(t).match, t).toBe(true);
    }
  });

  it('matches method-seeking phrasing', () => {
    for (const t of [
      'cómo morir sin dolor',
      'como suicidarme',
      'la manera menos dolorosa de morir',
      'forma de matarme',
    ]) {
      expect(detectCrisis(t).match, t).toBe(true);
    }
  });

  it('catches Spanish suicide words via the shared suicid\\w* rule', () => {
    expect(detectCrisis('pienso en el suicidio').match).toBe(true);
    expect(detectCrisis('me siento suicida').match).toBe(true);
  });

  it('reports lang from the locale hint for non-Turkish matches', () => {
    expect(detectCrisis('quiero morir', 'es').lang).toBe('es');
  });

  it('does NOT match benign Spanish text', () => {
    expect(detectCrisis('quiero vivir en otra ciudad').match).toBe(false);
    expect(detectCrisis('hoy quiero correr un poco más').match).toBe(false);
  });
});

// ─── detectCrisis — Turkish ───────────────────────────────────────────────────

describe('detectCrisis — Turkish ideation', () => {
  it('matches ideation phrases', () => {
    for (const t of [
      'intihar etmek istiyorum',
      'kendime zarar vermek istiyorum',
      'kendimi öldürmek istiyorum',
      'kendimi öldüreceğim',
      'kendimi öldür artık',
      'burada olmak istemiyorum',
      'artık yaşamak istemiyorum',
      'hayatıma son vermek istiyorum',
      'ben olmasam daha iyi',
      'canıma kıymak istiyorum',
      'ölmek istiyorum',
      'ölmeyi düşünüyorum',
    ]) {
      expect(detectCrisis(t).match, t).toBe(true);
    }
  });

  it('always reports lang "tr" for a Turkish match, even with an es hint', () => {
    expect(detectCrisis('intihar etmek istiyorum', 'es').lang).toBe('tr');
  });
});

describe('detectCrisis — Turkish method-seeking', () => {
  it('matches the conjugations the old regex missed', () => {
    for (const t of [
      'kendimi en acısız şekilde nasıl öldürebilirim',
      'en acısız ölüm yöntemi nedir',
      'nasıl ölürüm',
      'nasıl ölebilirim',
      'acısız intihar yöntemleri',
      'acısız ölüm istiyorum',
    ]) {
      expect(detectCrisis(t).match, t).toBe(true);
    }
  });

  it('does NOT match "ölmek istemiyorum" (the opposite intent)', () => {
    expect(detectCrisis('ölmek istemiyorum').match).toBe(false);
  });

  it('does NOT match benign Turkish text', () => {
    expect(detectCrisis('bugün işe nasıl gideceğim').match).toBe(false);
  });
});

// ─── detectCrisis — structural ────────────────────────────────────────────────

describe('detectCrisis — structural', () => {
  it('returns the first matching line when multiple lines exist', () => {
    const r = detectCrisis('good morning\nsuicidal thoughts again\nbad day');
    expect(r.match).toBe(true);
    expect(r.line).toBe('suicidal thoughts again');
  });

  it('is case-insensitive', () => {
    expect(detectCrisis('KILL MYSELF').match).toBe(true);
    expect(detectCrisis('Suicidal').match).toBe(true);
    expect(detectCrisis('INTIHAR ETMEK ISTIYORUM').match).toBe(true);
  });

  it('returns match:false + lang "en" for empty / non-string input', () => {
    expect(detectCrisis('')).toEqual({ match: false, line: '', lang: 'en' });
    // @ts-expect-error intentional misuse to test the runtime guard
    expect(detectCrisis(null).match).toBe(false);
  });
});
