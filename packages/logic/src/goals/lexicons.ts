/**
 * @ollie/logic · goals lexicons
 *
 * Compiled regexes used by pattern detectors.
 * Source: void-app.html VOID.logic.goals IIFE ~lines 22485–23095.
 */

import { wrap } from './helpers';

export const LOW_MOOD_RE =
  /\b(exhausted|done|hopeless|empty|numb|crashing|burnt out|nothing matters|bittim|tükendim|umutsuz|boş|hiçbir şey|yorgunum|battım)\b/i;

export const RESEARCH_RE = wrap([
  'research(?:ing|ed)?', 'reading\\s*about', 'looking\\s*into', 'looking\\s*up',
  'thinking\\s*about', 'planning', 'drafting\\s*(?:a\\s*)?plan', 'brainstorm(?:ing|ed)?',
  'watching\\s*(?:a\\s*)?(?:video|tutorial|course)', 'listening\\s*to\\s*(?:a\\s*)?podcast',
  'taking\\s*notes', 'outlining', 'mapping\\s*out', 'figuring\\s*out',
  'araştır(?:ıyorum|ma|dım)', 'arastir(?:iyorum|ma|dim)',
  'okuyorum', 'düşünüyorum', 'dusunuyorum',
  'plan(?:lıyorum|lama)', 'plan(?:liyorum|lama)',
  'je\\s*recherche', 'je\\s*lis', 'je\\s*réfléchis', 'je\\s*reflechis', 'je\\s*planifie',
  'investigando', 'leyendo', 'pensando\\s*en', 'planificando',
  'recherchiere', 'lese\\s*über', 'denke\\s*nach', 'plane\\s*(?:gerade|noch)',
]);

export const DOING_RE = wrap([
  'finished', 'completed', 'shipped', 'published', 'submitted', 'launched',
  'sent\\s*(?:the|an?|it)', 'called', 'booked', 'signed', 'filed',
  'wrote\\s*(?:the|a|it)', 'built', 'coded', 'deployed', 'recorded',
  'presented', 'delivered', 'uploaded', 'posted',
  'bitirdim', 'gönderdim', 'gonderdim', 'yayınladım', 'yayinladim',
  'teslim\\s*ettim', 'yaptım', 'yaptim', 'aradım', 'aradim',
  'j\'ai\\s*terminée?', 'j\'ai\\s*envoyée?', 'j\'ai\\s*publiée?',
  'j\'ai\\s*soumise?', 'j\'ai\\s*construit', 'j\'ai\\s*appelée?',
  'terminée?', 'envié', 'publiqué', 'entregué', 'llamé', 'hice',
  'fertiggestellt', 'gesendet', 'veröffentlicht', 'veroffentlicht',
  'eingereicht', 'angerufen',
]);

export const IDENTITY_RE = wrap([
  'i\'m\\s*a\\b', 'i\\s*am\\s*a\\b', 'becoming\\s*a\\b',
  'as\\s*a\\b', 'in\\s*my\\s*role\\s*as\\b',
  'writer', 'runner', 'reader', 'athlete', 'entrepreneur', 'founder',
  'creator', 'artist', 'musician', 'coder', 'developer',
  'morning\\s*person', 'healthy\\s*person', 'meditator',
  'kimliğim', 'kimligim', 'benim\\s*rolüm', 'benim\\s*rolum',
  'yazar(?:ım|im)?', 'koşucu(?:yum)?', 'kosucuyum', 'girişimci(?:yim)?', 'girisimciyim',
  'je\\s*suis\\s*un(?:e)?\\b', 'en\\s*tant\\s*que\\b',
  'soy\\s*un(?:a)?\\b', 'convirtiéndome\\s*en', 'convirtiendome\\s*en',
  'ich\\s*bin\\s*ein(?:e)?\\b',
]);

export const EXTERNAL_TRIGGER_RE = wrap([
  'saw\\s+\\w+\'s', 'saw\\s+(?:a|the|an)?\\s*(?:post|video|tweet|story|reel|doc|talk|article)',
  'watched\\s+(?:a|the|an)?\\s*(?:video|doc(?:umentary)?|talk|ted\\s*talk|course)',
  'read\\s+(?:a|about|that|how)', 'read\\s+\\w+\'s',
  'inspired\\s+by', 'everyone\\s+(?:is|seems|looks)',
  'my\\s+(?:friend|colleague|partner|sister|brother|mom|dad|roommate)\\s+(?:does|is|started|told)',
  'after\\s+(?:seeing|watching|reading|talking)',
  'scrolling', 'instagram\\s+made\\s+me', 'tiktok\\s+made\\s+me',
  'gördüm\\s+ve', 'izledim\\s+ve', 'etkilendim', 'arkadaşım\\s+(?:yapıyor|başladı)',
  'arkadasim', 'herkes\\s+yapıyor', 'herkes\\s+yapiyor',
  'j\'ai\\s+vu', 'inspirée?\\s+par', 'tout\\s+le\\s+monde\\s+(?:fait|semble)',
  'vi\\s+(?:un|una)', 'me\\s+inspiré', 'todo\\s+el\\s+mundo\\s+(?:lo\\s+hace|parece)',
  'ich\\s+habe\\s+gesehen', 'inspiriert\\s+von', 'alle\\s+machen',
]);

export const ANTI_GOAL_RE = wrap([
  'don\'?t\\s+want\\s+to\\s+be(?:come)?', 'do\\s+not\\s+want\\s+to\\s+be(?:come)?',
  'not\\s+become', 'never\\s+want\\s+to\\s+be(?:come)?',
  'avoid\\s+becoming', 'avoid\\s+being', 'scared\\s+of\\s+becoming',
  'afraid\\s+of\\s+(?:becoming|being)',
  'don\'?t\\s+want\\s+to\\s+end\\s+up', 'don\'?t\\s+want\\s+to\\s+turn\\s+into',
  'refuse\\s+to\\s+(?:be|become)', 'stop\\s+being',
  'olmak\\s+istemiyorum', 'olmak\\s+korkuyorum', 'kaçınmak\\s+istiyorum',
  'kacinmak\\s+istiyorum',
  'ne\\s+veux\\s+pas\\s+devenir', 'éviter\\s+de\\s+devenir', 'eviter\\s+de\\s+devenir',
  'peur\\s+de\\s+devenir',
  'no\\s+quiero\\s+convertirme', 'evitar\\s+(?:ser|convertirme)', 'miedo\\s+a\\s+convertirme',
  'nicht\\s+werden\\s+wollen', 'vermeiden\\s+zu\\s+(?:sein|werden)',
  'angst\\s+davor\\s+zu\\s+werden',
]);
