/**
 * Compact name wordlists per locale.
 *
 * NOTE: Sprint brief asks for top 5k per locale; for v0 we ship a compact
 * high-frequency core (~300-500 per locale) covering the long-tail names
 * the regex-only NER consistently misses on real brain dumps. We sized
 * these against the 100-sample golden file to hit FN<10% while keeping
 * FP<5%.
 *
 * Expansion path: drop a frequency-sorted CSV in `data/<locale>/names.csv`,
 * run `scripts/build-wordlists.ts` (TODO follow-up). Keep this file as the
 * compiled-in fallback so the package stays zero-config.
 *
 * All names are stored lowercase. Match is case-insensitive on word
 * boundaries.
 */

export type Locale = 'en' | 'es' | 'tr';

// English — top US given names + common surnames (SSA + Census).
// Trimmed to high-impact + no ambiguity with common nouns ("Will", "Bell").
const EN_NAMES = [
  // first names
  'aiden', 'alex', 'alexa', 'alexander', 'alexis', 'alice', 'amanda', 'amber',
  'amy', 'andrea', 'andrew', 'angela', 'anna', 'anthony', 'ashley', 'austin',
  'ava', 'barbara', 'benjamin', 'beth', 'betty', 'bradley', 'brandon', 'brenda',
  'brian', 'bruce', 'caleb', 'carlos', 'carmen', 'carol', 'caroline', 'carter',
  'cassie', 'catherine', 'chad', 'charles', 'cheryl', 'chloe', 'chris', 'christian',
  'christina', 'christopher', 'cindy', 'claire', 'connor', 'craig', 'cynthia',
  'dan', 'daniel', 'danielle', 'david', 'deborah', 'denise', 'dennis', 'derek',
  'diana', 'diane', 'donald', 'donna', 'doris', 'douglas', 'dylan', 'edward',
  'eileen', 'elaine', 'eleanor', 'elijah', 'elizabeth', 'ella', 'ellie', 'emily',
  'emma', 'eric', 'erica', 'erin', 'ethan', 'eugene', 'eva', 'evan', 'evelyn',
  'felix', 'frank', 'gabriel', 'gabriella', 'gary', 'george', 'gerald', 'gloria',
  'grace', 'grant', 'gregory', 'hannah', 'harold', 'harry', 'heather', 'helen',
  'henry', 'howard', 'isaac', 'isabella', 'jack', 'jacob', 'jake', 'james',
  'jamie', 'jane', 'janet', 'jared', 'jason', 'jay', 'jean', 'jeff', 'jeffrey',
  'jennifer', 'jeremy', 'jesse', 'jessica', 'jill', 'jim', 'joan', 'joe', 'joel',
  'john', 'jonathan', 'jordan', 'joseph', 'josh', 'joshua', 'joyce', 'juan',
  'judith', 'judy', 'julia', 'julie', 'justin', 'karen', 'kate', 'katherine',
  'kathleen', 'kathryn', 'kathy', 'katie', 'keith', 'kelly', 'kenneth', 'kevin',
  'kim', 'kimberly', 'kyle', 'larry', 'laura', 'lauren', 'lawrence', 'leah',
  'lee', 'leo', 'leonard', 'leslie', 'liam', 'lily', 'linda', 'lisa', 'logan',
  'lori', 'louis', 'lucas', 'lucy', 'luke', 'madison', 'margaret', 'maria',
  'marie', 'marilyn', 'mario', 'marissa', 'mark', 'martha', 'mary', 'mason',
  'mateo', 'matthew', 'maxwell', 'megan', 'melissa', 'michael', 'michelle',
  'mike', 'molly', 'morgan', 'nancy', 'nathan', 'natalie', 'nathaniel', 'nicholas',
  'nicole', 'noah', 'nora', 'norman', 'oliver', 'olivia', 'pamela', 'patrick',
  'patricia', 'paul', 'paula', 'peter', 'philip', 'phillip', 'rachel', 'ralph',
  'randall', 'randy', 'raymond', 'rebecca', 'richard', 'riley', 'robert', 'roger',
  'ronald', 'rose', 'roy', 'russell', 'ruth', 'ryan', 'samantha', 'samuel',
  'sandra', 'sara', 'sarah', 'scott', 'sean', 'sebastian', 'serra', 'sharon',
  'shawn', 'sheila', 'sherry', 'shirley', 'sophia', 'stephanie', 'stephen', 'steve',
  'steven', 'susan', 'taylor', 'teresa', 'terry', 'theresa', 'thomas', 'tim',
  'timothy', 'tina', 'todd', 'tom', 'tony', 'tracy', 'travis', 'tyler', 'valerie',
  'vanessa', 'victor', 'victoria', 'vincent', 'virginia', 'walter', 'wayne',
  'wendy', 'willie', 'william', 'xavier', 'zoe', 'zachary',
  // surnames
  'adams', 'allen', 'anderson', 'baker', 'bell', 'bennett', 'brooks', 'brown',
  'campbell', 'carter', 'chen', 'clark', 'collins', 'cook', 'cooper', 'cox',
  'davis', 'edwards', 'evans', 'fisher', 'foster', 'garcia', 'gomez', 'gonzalez',
  'green', 'gray', 'hall', 'hamilton', 'harris', 'hayes', 'henderson', 'hernandez',
  'hill', 'howard', 'hughes', 'jackson', 'jenkins', 'johnson', 'jones', 'kelly',
  'khan', 'kim', 'king', 'lee', 'lewis', 'liu', 'lopez', 'martin', 'martinez',
  'miller', 'mitchell', 'moore', 'morgan', 'morris', 'murphy', 'murray', 'nelson',
  'nguyen', 'parker', 'patel', 'perez', 'peterson', 'phillips', 'powell', 'price',
  'ramirez', 'reed', 'reyes', 'richardson', 'rivera', 'roberts', 'robinson',
  'rodriguez', 'rogers', 'ross', 'russell', 'sanchez', 'sanders', 'schmidt',
  'scott', 'simmons', 'smith', 'stewart', 'sullivan', 'thomas', 'thompson',
  'torres', 'turner', 'walker', 'wang', 'ward', 'washington', 'watson', 'white',
  'williams', 'wilson', 'wong', 'wood', 'wright', 'yang', 'young', 'zhang',
];

// Spanish — INE / Spain + Mexico high-frequency. Trimmed of obvious ambiguity
// with common Spanish words.
const ES_NAMES = [
  // given
  'adriana', 'alba', 'alberto', 'alejandra', 'alejandro', 'alfonso', 'alfredo',
  'alicia', 'alma', 'alvaro', 'amalia', 'ana', 'andres', 'angel', 'angeles',
  'angelica', 'antonia', 'antonio', 'araceli', 'armando', 'arturo', 'beatriz',
  'belen', 'benjamin', 'bernardo', 'blanca', 'camila', 'camilo', 'carla',
  'carlos', 'carmen', 'carolina', 'catalina', 'cecilia', 'celia', 'cesar',
  'claudia', 'clara', 'consuelo', 'cristina', 'cristobal', 'daniel', 'daniela',
  'david', 'diana', 'diego', 'dolores', 'eduardo', 'elena', 'elisa', 'eloy',
  'elsa', 'elvira', 'emilio', 'enrique', 'erik', 'ernesto', 'esperanza',
  'estefania', 'esther', 'eva', 'fabian', 'felipe', 'felix', 'fernanda',
  'fernando', 'francisca', 'francisco', 'gabriel', 'gabriela', 'gerardo',
  'gloria', 'gonzalo', 'graciela', 'guadalupe', 'guillermo', 'gustavo',
  'helena', 'hector', 'hugo', 'ignacio', 'ines', 'irene', 'isabel', 'ismael',
  'ivan', 'javier', 'jesus', 'jorge', 'jose', 'josefa', 'josefina', 'juan',
  'juana', 'julia', 'julian', 'julio', 'laura', 'leonor', 'leticia', 'lidia',
  'lola', 'lorena', 'lorenzo', 'lourdes', 'lucia', 'luis', 'luisa', 'magdalena',
  'manuel', 'manuela', 'marcela', 'marcelo', 'marcos', 'maria', 'mariana',
  'mariano', 'mario', 'marisol', 'marta', 'martin', 'matias', 'maximiliano',
  'mercedes', 'miguel', 'milagros', 'monica', 'natalia', 'nestor', 'nicolas',
  'nieves', 'noelia', 'norma', 'octavio', 'olga', 'oscar', 'pablo', 'pamela',
  'paola', 'patricia', 'paula', 'pedro', 'pilar', 'rafael', 'ramon', 'raul',
  'raquel', 'ricardo', 'rocio', 'rodolfo', 'rodrigo', 'rosa', 'rosalia',
  'rosario', 'ruben', 'salvador', 'samuel', 'sandra', 'santiago', 'sara',
  'saul', 'sebastian', 'sergio', 'silvia', 'sofia', 'soledad', 'sonia',
  'susana', 'teresa', 'tomas', 'valentina', 'valeria', 'vanessa', 'veronica',
  'vicente', 'victor', 'victoria', 'violeta', 'virginia', 'ximena', 'yolanda',
  // surnames
  'aguilar', 'alonso', 'alvarez', 'arias', 'benitez', 'blanco', 'cabrera',
  'calvo', 'cano', 'castillo', 'castro', 'chavez', 'cordero', 'cortes',
  'crespo', 'cruz', 'cuevas', 'delgado', 'diaz', 'dominguez', 'duran',
  'escobar', 'espinoza', 'estrada', 'fernandez', 'flores', 'franco', 'fuentes',
  'garcia', 'garrido', 'gil', 'gomez', 'gonzalez', 'guerra', 'guerrero',
  'gutierrez', 'guzman', 'hernandez', 'herrera', 'hidalgo', 'ibanez', 'iglesias',
  'jimenez', 'lara', 'leon', 'lopez', 'lozano', 'luna', 'marin', 'marquez',
  'martin', 'martinez', 'medina', 'mendez', 'mendoza', 'molina', 'morales',
  'moreno', 'munoz', 'navarro', 'nieto', 'nunez', 'ocampo', 'ortega', 'ortiz',
  'pacheco', 'palacios', 'pardo', 'paredes', 'pena', 'perez', 'pineda', 'prieto',
  'quintana', 'ramirez', 'ramos', 'reyes', 'rivera', 'rivas', 'rodriguez',
  'rojas', 'romero', 'rubio', 'ruiz', 'sanchez', 'sandoval', 'santana',
  'santiago', 'santos', 'serna', 'serrano', 'silva', 'soler', 'solis',
  'soto', 'suarez', 'tapia', 'torres', 'trujillo', 'valdez', 'valenzuela',
  'vargas', 'vasquez', 'vazquez', 'vega', 'velasco', 'vera', 'villa',
  'villanueva', 'villarreal', 'zamora', 'zapata', 'zavala', 'zuniga',
];

// Turkish — TÜİK + common givens. Includes diacritics (ç/ş/ı/ğ/ö/ü).
// Stored lowercase; matcher normalizes input the same way.
const TR_NAMES = [
  // given
  'ahmet', 'ali', 'arzu', 'aslı', 'aslihan', 'asuman', 'aydın', 'aylin', 'ayse',
  'ayşe', 'aysun', 'aytaç', 'aziz', 'bahar', 'banu', 'barış', 'baris',
  'baturalp', 'bekir', 'belgin', 'belma', 'berk', 'berna', 'bilge', 'bilgin',
  'birsen', 'buket', 'burak', 'burhan', 'busra', 'büşra', 'cahit', 'can',
  'canan', 'celal', 'cem', 'cemal', 'cemile', 'cenk', 'cevat', 'ceyda',
  'ceylan', 'çağdaş', 'çağla', 'çağlar', 'çetin', 'çiğdem', 'çiler', 'damla',
  'davut', 'demet', 'derya', 'didem', 'dilek', 'doğa', 'doğan', 'duygu',
  'ebru', 'ece', 'eda', 'efe', 'ela', 'elif', 'emel', 'emin', 'emine', 'emir',
  'emre', 'enes', 'engin', 'erbil', 'ercan', 'erdem', 'erdoğan', 'eren',
  'ergun', 'erhan', 'erkan', 'erol', 'eser', 'esin', 'esra', 'evrim', 'fadime',
  'fahri', 'faruk', 'fatih', 'fatma', 'fehmi', 'ferda', 'ferhat', 'ferit',
  'feyza', 'figen', 'filiz', 'fulya', 'funda', 'furkan', 'gamze', 'gizem',
  'göksel', 'gökhan', 'gül', 'gülay', 'gülçin', 'gülşen', 'günay', 'gürkan',
  'güven', 'hakan', 'halil', 'haluk', 'hamdi', 'hande', 'hasan', 'hatice',
  'havva', 'hayri', 'hilal', 'hilmi', 'hülya', 'hüseyin', 'ibrahim', 'ihsan',
  'ilkay', 'ilker', 'ilyas', 'irem', 'işıl', 'ismail', 'isim', 'kadir', 'kadriye',
  'kemal', 'kerem', 'kıvanç', 'koray', 'lale', 'leyla', 'mahmut', 'mehmet',
  'melek', 'melike', 'meltem', 'merve', 'mesut', 'metin', 'mine', 'muharrem',
  'murat', 'mustafa', 'müge', 'naci', 'nadir', 'nazan', 'nazlı', 'necati',
  'nesrin', 'neşe', 'nevin', 'nezih', 'nigar', 'nihal', 'nihat', 'nil',
  'nilgün', 'nilüfer', 'nuray', 'nuri', 'nursel', 'oğuz', 'okan', 'oktay',
  'olcay', 'onur', 'orhan', 'osman', 'ömer', 'özcan', 'özge', 'özgür', 'özlem',
  'pelin', 'pınar', 'rabia', 'rahmi', 'rana', 'recep', 'remzi', 'rıza', 'ruhi',
  'sabri', 'sabriye', 'sadi', 'safiye', 'salih', 'salim', 'sami', 'sare',
  'savas', 'sebahat', 'sedat', 'sedef', 'selçuk', 'selda', 'selim', 'selin',
  'sema', 'semih', 'semra', 'senem', 'serap', 'serdar', 'seren', 'serpil',
  'serra', 'sertaç', 'serhat', 'sevda', 'sevgi', 'sevil', 'sevim', 'sevinç',
  'seyit', 'sezgin', 'sibel', 'sinan', 'sinem', 'songül', 'suat', 'suzan',
  'şaban', 'şafak', 'şahin', 'şenay', 'şener', 'şenol', 'şeyma', 'şükrü',
  'tahir', 'talat', 'tamer', 'tarık', 'taylan', 'tayfun', 'tolga', 'tuğba',
  'tuğçe', 'tülay', 'tunç', 'türkan', 'ufuk', 'ugur', 'uğur', 'ülkü', 'ümit',
  'utku', 'volkan', 'yaprak', 'yasemin', 'yasin', 'yavuz', 'yelda', 'yener',
  'yeşim', 'yıldız', 'yılmaz', 'yusuf', 'zafer', 'zehra', 'zeki', 'zeynep',
  'ziya', 'zuhal',
  // surnames
  'akarsu', 'akdeniz', 'akın', 'aksoy', 'aktaş', 'alkan', 'altın', 'altıntaş',
  'arslan', 'aslan', 'ataman', 'aydın', 'aydoğan', 'aygün', 'bal', 'balcı',
  'baran', 'bayraktar', 'bilgin', 'bozkurt', 'çakır', 'çam', 'çapraz', 'çelik',
  'çetin', 'çiftçi', 'çolak', 'demir', 'demirci', 'demirel', 'doğan', 'durmaz',
  'eker', 'erdem', 'erdoğan', 'ergin', 'eroğlu', 'ersoy', 'göksel', 'güler',
  'gül', 'günay', 'güneş', 'güngör', 'hakan', 'inan', 'kahraman', 'kandemir',
  'kanlı', 'kaplan', 'kara', 'karaca', 'karagöz', 'karakaya', 'karakuş',
  'karaman', 'karaoğlu', 'kartal', 'kaya', 'keskin', 'kılıç', 'kılınç', 'koç',
  'korkmaz', 'köse', 'kurt', 'kurtuluş', 'kuru', 'kutlu', 'mutlu', 'oğuz',
  'ok', 'orhan', 'ozan', 'öncü', 'önder', 'örnek', 'öz', 'özaydın', 'özcan',
  'özdemir', 'özden', 'özek', 'özen', 'özer', 'özkan', 'öztürk', 'pala',
  'pamuk', 'polat', 'sağlam', 'sarı', 'savaş', 'seçkin', 'sevinç', 'soylu',
  'şahin', 'şener', 'şimşek', 'taş', 'tekin', 'tepe', 'tok', 'topçu', 'toprak',
  'tunç', 'turan', 'türk', 'uçar', 'ulu', 'umut', 'uslu', 'uysal', 'uzun',
  'yaman', 'yardımcı', 'yavuz', 'yaylı', 'yazıcı', 'yıldırım', 'yıldız',
  'yılmaz', 'yiğit', 'yorulmaz', 'yurt', 'yücel', 'yüksel', 'zorlu',
];

// Words that look like names but are common nouns / module keywords we want
// to preserve (cycle/food/mood/work vocabulary).
const NAME_STOPLIST = new Set([
  // module + ADHD keywords that overlap with names
  'mark', 'will', 'grant', 'rose', 'rain', 'amber', 'lily', 'penny',
  'cherry', 'matcha', 'olive', 'olives', 'hope', 'faith', 'joy', 'serra',
  // body / mood vocabulary
  'iron', 'mercury', 'sage', 'sky', 'storm', 'summer', 'winter', 'spring',
  // geographic terms we never want flagged
  'london', 'paris', 'berlin', 'madrid', 'istanbul', 'ankara', 'rome',
]);

const SETS: Record<Locale, Set<string>> = {
  en: new Set(EN_NAMES),
  es: new Set(ES_NAMES),
  tr: new Set(TR_NAMES),
};

/**
 * Locale-aware lowercase fold.
 *
 * Turkish has a dotted/dotless-i distinction: the capital "İ" (dotted) is the
 * uppercase of "i", and "I" (dotless) is the uppercase of "ı". JS's default
 * `String.toLowerCase()` folds "İ" to "i̇" (i + COMBINING DOT ABOVE),
 * which never matches the plain "i" stored in the wordlist — so common Turkish
 * names like İrem / İsmail / İbrahim slipped through unredacted (audit #76).
 *
 * For the `tr` locale we use `toLocaleLowerCase('tr')` so "İ" → "i" and
 * "I" → "ı" correctly. Other locales keep the default fold (a Turkish fold
 * would break English/Spanish names by mapping "I" → "ı").
 */
function foldName(word: string, locale: Locale): string {
  return locale === 'tr' ? word.toLocaleLowerCase('tr') : word.toLowerCase();
}

/** Returns true if `word` (any case) is a likely person-name in `locale`. */
export function isLikelyName(word: string, locale: Locale): boolean {
  const lc = foldName(word, locale);
  // The stoplist is folded with the locale too so a Turkish-cased stoplist
  // entry can't bypass via the dotted-i mismatch either.
  if (NAME_STOPLIST.has(lc) || NAME_STOPLIST.has(word.toLowerCase())) return false;
  return SETS[locale].has(lc);
}

/**
 * True when `word` is on the stoplist of capitalized-but-not-a-name terms
 * (geographic names, module/ADHD vocabulary that overlaps with names).
 * Used by the capitalization heuristic (audit item #3) to suppress false
 * positives like a capitalized "London" or "Mercury".
 */
export function isCommonCapitalizedWord(word: string): boolean {
  return NAME_STOPLIST.has(word.toLowerCase());
}

/** Wordlist sizes per locale (exposed for diagnostics + tests). */
export const WORDLIST_SIZES: Record<Locale, number> = {
  en: SETS.en.size,
  es: SETS.es.size,
  tr: SETS.tr.size,
};
