/**
 * @ollie/logic · grocery · alias + recipe tables
 *
 * Pure data — no I/O, no side effects.
 */

import type { AliasEntry, GroceryCategory, RecipeEntry } from './types';

type AliasTable = Record<string, AliasEntry>;
type RecipeTable = Record<string, RecipeEntry>;

function buildAliasTable(): AliasTable {
  const T: AliasTable = {};
  const add = (
    canon: string,
    aliases: string[],
    category: GroceryCategory,
    shelfLifeDays: number,
  ) => {
    T[canon] = { aliases: aliases.slice(), category, shelfLifeDays };
  };
  // Dairy
  add('milk', ['milk','süt','sut','whole milk','2% milk','skim milk'], 'dairy', 7);
  add('yogurt', ['yogurt','yogurts','yog','yoğurt','yogurd','greek yogurt','plain yogurt'], 'dairy', 21);
  add('cheese', ['cheese','cheddar','gouda','kaşar','kasar','peynir'], 'dairy', 30);
  add('feta', ['feta','beyaz peynir'], 'dairy', 30);
  add('butter', ['butter','tereyağı','tereyagi','salted butter','unsalted butter'], 'dairy', 60);
  add('cream', ['cream','krema','heavy cream','whipping cream'], 'dairy', 10);
  add('sour cream', ['sour cream','ekşi krema','eksi krema'], 'dairy', 14);
  add('cottage cheese', ['cottage cheese','lor'], 'dairy', 10);
  add('cream cheese', ['cream cheese','philly'], 'dairy', 30);
  add('egg', ['egg','eggs','dozen eggs','yumurta'], 'dairy', 28);
  add('mozzarella', ['mozzarella','fresh mozzarella'], 'dairy', 14);
  add('parmesan', ['parmesan','parmigiano','parmigiano reggiano'], 'dairy', 90);
  add('ricotta', ['ricotta'], 'dairy', 14);
  add('kefir', ['kefir'], 'dairy', 14);
  add('labneh', ['labneh','labne','süzme yoğurt','suzme yogurt'], 'dairy', 14);
  // Meat
  add('chicken', ['chicken','tavuk','chicken breast','chicken thigh'], 'meat', 2);
  add('ground beef', ['ground beef','mince','kıyma','kiyma','dana kıyma','dana kiyma'], 'meat', 2);
  add('beef', ['beef','dana','biftek','steak','ribeye'], 'meat', 4);
  add('lamb', ['lamb','kuzu','lamb chop'], 'meat', 4);
  add('pork', ['pork','pork chop','pork loin'], 'meat', 4);
  add('turkey', ['turkey','hindi'], 'meat', 2);
  add('fish', ['fish','balık','balik','somon','levrek','salmon'], 'meat', 2);
  add('shrimp', ['shrimp','karides','prawns'], 'meat', 2);
  add('ground turkey', ['ground turkey','hindi kıyma','hindi kiyma'], 'meat', 2);
  add('sausage', ['sausage','sucuk','sosis','italian sausage'], 'meat', 14);
  add('bacon', ['bacon','pastırma','pastirma'], 'meat', 14);
  add('veal', ['veal','dana eti'], 'meat', 4);
  add('duck', ['duck','ördek','ordek'], 'meat', 4);
  add('liver', ['liver','ciğer','ciger','dana ciğeri','dana cigeri'], 'meat', 2);
  add('mussels', ['mussels','midye'], 'meat', 2);
  // Deli
  add('ham', ['ham','jambon','smoked ham'], 'deli', 7);
  add('salami', ['salami','salam','sucuklu salam'], 'deli', 21);
  add('prosciutto', ['prosciutto','parma'], 'deli', 21);
  add('pepperoni', ['pepperoni'], 'deli', 21);
  add('turkey slices', ['turkey slices','hindi füme','hindi fume','sliced turkey'], 'deli', 7);
  add('chicken slices', ['chicken slices','tavuk füme','tavuk fume'], 'deli', 7);
  add('mortadella', ['mortadella','mortadel'], 'deli', 21);
  add('chorizo', ['chorizo'], 'deli', 21);
  add('hot dog', ['hot dog','frankfurter'], 'deli', 14);
  add('roast beef', ['roast beef','deli beef'], 'deli', 7);
  // Produce
  add('tomato', ['tomato','tomatoes','domates','cherry tomato','vine tomato'], 'produce', 7);
  add('onion', ['onion','onions','soğan','sogan','yellow onion','red onion'], 'produce', 30);
  add('garlic', ['garlic','sarımsak','sarimsak','garlic clove'], 'produce', 90);
  add('potato', ['potato','potatoes','patates','russet','yukon'], 'produce', 30);
  add('sweet potato', ['sweet potato','tatlı patates','tatli patates','yam'], 'produce', 21);
  add('carrot', ['carrot','carrots','havuç','havuc','baby carrots'], 'produce', 21);
  add('celery', ['celery','kereviz sapı','kereviz sapi'], 'produce', 14);
  add('cucumber', ['cucumber','salatalık','salatalik'], 'produce', 7);
  add('zucchini', ['zucchini','kabak','courgette'], 'produce', 7);
  add('eggplant', ['eggplant','patlıcan','patlican','aubergine'], 'produce', 7);
  add('bell pepper', ['bell pepper','dolma biber','red pepper','green pepper'], 'produce', 10);
  add('hot pepper', ['hot pepper','sivri biber','acı biber','aci biber','jalapeño','jalapeno'], 'produce', 14);
  add('spinach', ['spinach','ıspanak','ispanak','baby spinach'], 'produce', 5);
  add('arugula', ['arugula','roka','rocket'], 'produce', 5);
  add('lettuce', ['lettuce','marul','romaine','iceberg'], 'produce', 7);
  add('kale', ['kale','karalahana','lacinato'], 'produce', 7);
  add('cabbage', ['cabbage','lahana'], 'produce', 30);
  add('parsley', ['parsley','maydanoz'], 'produce', 7);
  add('cilantro', ['cilantro','kişniş','kisnis','coriander'], 'produce', 5);
  add('basil', ['basil','fesleğen','feslegen'], 'produce', 5);
  add('mint', ['mint','nane'], 'produce', 7);
  add('dill', ['dill','dereotu'], 'produce', 5);
  add('mushroom', ['mushroom','mushrooms','mantar','button mushroom','cremini'], 'produce', 7);
  add('broccoli', ['broccoli','brokoli'], 'produce', 7);
  add('cauliflower', ['cauliflower','karnabahar'], 'produce', 7);
  add('green beans', ['green beans','taze fasulye'], 'produce', 7);
  add('asparagus', ['asparagus','kuşkonmaz','kuskonmaz'], 'produce', 5);
  add('artichoke', ['artichoke','enginar'], 'produce', 7);
  add('leek', ['leek','pırasa','pirasa'], 'produce', 14);
  add('radish', ['radish','turp'], 'produce', 14);
  add('beet', ['beet','pancar','beetroot'], 'produce', 30);
  add('banana', ['banana','bananas','muz'], 'produce', 7);
  add('apple', ['apple','apples','elma','gala','fuji','granny smith'], 'produce', 30);
  add('orange', ['orange','oranges','portakal','navel'], 'produce', 21);
  add('lemon', ['lemon','lemons','limon'], 'produce', 21);
  add('lime', ['lime','misket limon'], 'produce', 14);
  add('avocado', ['avocado','avokado','hass'], 'produce', 5);
  add('strawberry', ['strawberry','strawberries','çilek','cilek'], 'produce', 5);
  add('blueberry', ['blueberry','blueberries','yaban mersini'], 'produce', 7);
  add('grape', ['grape','grapes','üzüm','uzum'], 'produce', 7);
  // Drinks
  add('water', ['water','su','maden suyu','sparkling water'], 'drinks', 365);
  add('juice', ['juice','meyve suyu','oj','apple juice','orange juice'], 'drinks', 10);
  add('coffee', ['coffee','kahve','beans','ground coffee'], 'drinks', 365);
  add('tea', ['tea','çay','cay','black tea','green tea'], 'drinks', 730);
  add('oat milk', ['oat milk','oatmilk'], 'drinks', 10);
  add('almond milk', ['almond milk','almondmilk'], 'drinks', 10);
  add('soy milk', ['soy milk','soymilk'], 'drinks', 10);
  add('beer', ['beer','bira','lager','ipa'], 'drinks', 120);
  add('wine', ['wine','şarap','sarap','red wine','white wine'], 'drinks', 730);
  add('soda', ['soda','gazoz','kola','cola','coke','pepsi'], 'drinks', 270);
  add('kombucha', ['kombucha'], 'drinks', 21);
  add('sparkling', ['sparkling','perrier','la croix'], 'drinks', 270);
  add('lemonade', ['lemonade','limonata'], 'drinks', 10);
  add('ayran', ['ayran'], 'drinks', 14);
  add('energy drink', ['energy drink','red bull','monster'], 'drinks', 365);
  // Pantry
  add('rice', ['rice','pirinç','pirinc','basmati','jasmine'], 'pantry', 730);
  add('pasta', ['pasta','makarna','spaghetti','penne','fusilli'], 'pantry', 730);
  add('flour', ['flour','un','all-purpose flour','all purpose flour'], 'pantry', 365);
  add('sugar', ['sugar','şeker','seker','white sugar'], 'pantry', 730);
  add('brown sugar', ['brown sugar','esmer şeker','esmer seker'], 'pantry', 730);
  add('salt', ['salt','tuz','sea salt','kosher salt'], 'pantry', 3650);
  add('black pepper', ['black pepper','karabiber','ground pepper'], 'pantry', 1095);
  add('olive oil', ['olive oil','zeytinyağı','zeytinyagi','evoo','extra virgin olive oil','extra virgin'], 'pantry', 730);
  add('vegetable oil', ['vegetable oil','ayçiçek yağı','aycicek yagi','canola','sunflower oil'], 'pantry', 365);
  add('sesame oil', ['sesame oil','susam yağı','susam yagi'], 'pantry', 365);
  add('vinegar', ['vinegar','sirke','white vinegar','apple cider vinegar'], 'pantry', 1825);
  add('balsamic', ['balsamic','balsamic vinegar'], 'pantry', 1825);
  add('soy sauce', ['soy sauce','soya sosu'], 'pantry', 1095);
  add('tomato sauce', ['tomato sauce','salça','salca','marinara','pasta sauce'], 'pantry', 10);
  add('tomato paste', ['tomato paste'], 'pantry', 365);
  add('ketchup', ['ketchup','ketçap','ketcap'], 'pantry', 180);
  add('mayo', ['mayo','mayonez','mayonnaise'], 'pantry', 60);
  add('mustard', ['mustard','hardal','dijon'], 'pantry', 365);
  add('honey', ['honey','bal'], 'pantry', 3650);
  add('peanut butter', ['peanut butter','fıstık ezmesi','fistik ezmesi','pb'], 'pantry', 90);
  add('jam', ['jam','reçel','recel','jelly','preserves'], 'pantry', 365);
  add('bread', ['bread','ekmek','loaf','sourdough','rye'], 'pantry', 5);
  add('tortilla', ['tortilla','lavaş','lavas','wraps'], 'pantry', 21);
  add('cereal', ['cereal','mısır gevreği','misir gevregi','cornflakes','granola'], 'pantry', 180);
  add('oats', ['oats','yulaf','oatmeal','rolled oats'], 'pantry', 730);
  add('quinoa', ['quinoa','kinoa'], 'pantry', 730);
  add('couscous', ['couscous','kuskus'], 'pantry', 730);
  add('bulgur', ['bulgur'], 'pantry', 730);
  add('lentil', ['lentil','lentils','mercimek','red lentil'], 'pantry', 1095);
  add('chickpea', ['chickpea','chickpeas','nohut','garbanzo'], 'pantry', 1095);
  add('black bean', ['black bean','black beans','fasulye'], 'pantry', 1095);
  add('white bean', ['white bean','kuru fasulye','cannellini'], 'pantry', 1095);
  add('canned tomato', ['canned tomato','diced tomatoes','crushed tomatoes'], 'pantry', 730);
  add('chicken stock', ['chicken stock','tavuk suyu','chicken broth'], 'pantry', 365);
  add('beef stock', ['beef stock','beef broth'], 'pantry', 365);
  add('nuts', ['nuts','badem','ceviz','kaju','almonds'], 'pantry', 365);
  add('raisins', ['raisins','kuru üzüm','kuru uzum'], 'pantry', 365);
  add('olives', ['olives','zeytin','kalamata'], 'pantry', 180);
  add('tahini', ['tahini','tahin'], 'pantry', 730);
  add('yeast', ['yeast','maya','instant yeast','active dry yeast'], 'pantry', 365);
  // Cleaning
  add('toilet paper', ['toilet paper','tuvalet kağıdı','tuvalet kagidi','tp'], 'cleaning', 9999);
  add('paper towel', ['paper towel','kağıt havlu','kagit havlu'], 'cleaning', 9999);
  add('tissue', ['tissue','mendil','kleenex'], 'cleaning', 9999);
  add('dish soap', ['dish soap','bulaşık deterjanı','bulasik deterjani','fairy'], 'cleaning', 1825);
  add('laundry detergent', ['laundry detergent','çamaşır deterjanı','camasir deterjani'], 'cleaning', 365);
  add('fabric softener', ['fabric softener','yumuşatıcı','yumusatici'], 'cleaning', 365);
  add('bleach', ['bleach','çamaşır suyu','camasir suyu'], 'cleaning', 365);
  add('all purpose cleaner', ['all purpose cleaner','yüzey temizleyici','yuzey temizleyici'], 'cleaning', 730);
  add('sponge', ['sponge','sünger','sunger'], 'cleaning', 9999);
  add('trash bag', ['trash bag','çöp poşeti','cop poseti','garbage bag'], 'cleaning', 9999);
  add('dishwasher tabs', ['dishwasher tabs','makine tableti','finish tabs'], 'cleaning', 365);
  add('shampoo', ['shampoo','şampuan','sampuan'], 'cleaning', 1095);
  add('conditioner', ['conditioner','saç kremi','sac kremi'], 'cleaning', 1095);
  add('body wash', ['body wash','duş jeli','dus jeli'], 'cleaning', 1095);
  add('toothpaste', ['toothpaste','diş macunu','dis macunu'], 'cleaning', 730);
  // Frozen
  add('frozen pizza', ['frozen pizza'], 'frozen', 180);
  add('frozen veggies', ['frozen veggies','dondurulmuş sebze','dondurulmus sebze','mixed veg'], 'frozen', 240);
  add('frozen berries', ['frozen berries','dondurulmuş meyve','dondurulmus meyve'], 'frozen', 240);
  add('frozen peas', ['frozen peas','dondurulmuş bezelye','dondurulmus bezelye'], 'frozen', 240);
  add('ice cream', ['ice cream','dondurma','gelato'], 'frozen', 60);
  add('frozen shrimp', ['frozen shrimp','dondurulmuş karides','dondurulmus karides'], 'frozen', 180);
  add('frozen fish', ['frozen fish','dondurulmuş balık','dondurulmus balik','frozen salmon'], 'frozen', 180);
  add('frozen chicken', ['frozen chicken','dondurulmuş tavuk','dondurulmus tavuk'], 'frozen', 270);
  add('frozen fries', ['frozen fries','dondurulmuş patates','dondurulmus patates'], 'frozen', 240);
  add('frozen dough', ['frozen dough','hamur','pizza dough','croissant dough'], 'frozen', 60);
  // Snacks
  add('chips', ['chips','cips','lays','ruffles','doritos'], 'snacks', 60);
  add('crackers', ['crackers','kraker','ritz'], 'snacks', 120);
  add('chocolate', ['chocolate','çikolata','cikolata','dark chocolate','milk chocolate'], 'snacks', 365);
  add('cookies', ['cookies','kurabiye','bisküvi','biskuvi','biscuits'], 'snacks', 90);
  add('candy', ['candy','gummies'], 'snacks', 365);
  add('popcorn', ['popcorn','mısır patlağı','misir patlagi'], 'snacks', 240);
  add('pretzels', ['pretzels'], 'snacks', 120);
  add('trail mix', ['trail mix','gorp'], 'snacks', 180);
  add('granola bar', ['granola bar','kind bar','clif bar'], 'snacks', 180);
  add('nuts mix', ['nuts mix','kuruyemiş','kuruyemis','mixed nuts'], 'snacks', 180);
  add('dried fruit', ['dried fruit','kuru meyve'], 'snacks', 365);
  add('rice cakes', ['rice cakes','pirinç patlağı','pirinc patlagi'], 'snacks', 180);
  add('hummus', ['hummus','humus'], 'snacks', 10);
  add('salsa', ['salsa'], 'snacks', 30);
  add('pickles', ['pickles','turşu','tursu'], 'snacks', 365);
  // Supplements
  add('multivitamin', ['multivitamin','multi'], 'supplements', 730);
  add('vitamin d', ['vitamin d','d3','d vitamini'], 'supplements', 730);
  add('vitamin c', ['vitamin c','c vitamini'], 'supplements', 730);
  add('magnesium', ['magnesium','mag glycinate','magnezyum'], 'supplements', 730);
  add('iron', ['iron','demir','ferritin'], 'supplements', 730);
  add('omega 3', ['omega 3','balık yağı','balik yagi','fish oil'], 'supplements', 365);
  add('b12', ['b12','vitamin b12'], 'supplements', 730);
  add('probiotics', ['probiotics','probiyotik'], 'supplements', 365);
  add('electrolytes', ['electrolytes','lmnt','liquid iv'], 'supplements', 730);
  add('melatonin', ['melatonin'], 'supplements', 730);
  // Spices (stored under pantry category)
  add('cumin', ['cumin','kimyon'], 'pantry', 1095);
  add('paprika', ['paprika','kırmızı toz biber','kirmizi toz biber','smoked paprika'], 'pantry', 1095);
  add('oregano', ['oregano'], 'pantry', 1095);
  add('thyme', ['thyme','kekik'], 'pantry', 1095);
  add('rosemary', ['rosemary','biberiye'], 'pantry', 1095);
  add('bay leaf', ['bay leaf','defne yaprağı','defne yapragi'], 'pantry', 1095);
  add('chili flakes', ['chili flakes','pul biber','red pepper flakes'], 'pantry', 1095);
  add('cinnamon', ['cinnamon','tarçın','tarcin','ground cinnamon'], 'pantry', 1095);
  add('turmeric', ['turmeric','zerdeçal','zerdecal'], 'pantry', 1095);
  add('ginger', ['ginger','zencefil','fresh ginger','ground ginger'], 'pantry', 1095);
  add('nutmeg', ['nutmeg','küçük hindistan cevizi','kucuk hindistan cevizi'], 'pantry', 1095);
  add('clove', ['clove','karanfil','ground clove'], 'pantry', 1095);
  add('cardamom', ['cardamom','kakule'], 'pantry', 1095);
  add('sumac', ['sumac','sumak'], 'pantry', 1095);
  add('mint dried', ['mint dried','kuru nane'], 'pantry', 1095);
  return T;
}

function buildRecipeTable(): RecipeTable {
  const R: RecipeTable = {};
  const add = (
    canon: string,
    aliases: string[],
    cuisine: string,
    ingredients: string[],
  ) => {
    R[canon] = { aliases: aliases.slice(), cuisine, ingredients: ingredients.slice() };
  };
  // Turkish
  add('menemen', ['menemen'], 'turkish', ['egg','tomato','bell pepper','onion','salt','butter','black pepper']);
  add('manti', ['manti','mantı','türk ravyolisi','turk ravyolisi'], 'turkish', ['flour','ground beef','onion','garlic','yogurt','butter','paprika','mint dried']);
  add('köfte', ['köfte','kofte','izmir köftesi','izmir koftesi'], 'turkish', ['ground beef','onion','garlic','parsley','bread','egg','cumin','salt']);
  add('dolma', ['dolma','yaprak sarması','yaprak sarmasi'], 'turkish', ['rice','onion','parsley','mint','olive oil','lemon','tomato paste','salt','black pepper']);
  add('lahmacun', ['lahmacun'], 'turkish', ['flour','ground beef','tomato','onion','parsley','paprika','cumin','salt']);
  add('ezogelin', ['ezogelin','ezogelin çorbası','ezogelin corbasi'], 'turkish', ['lentil','rice','bulgur','onion','tomato paste','mint dried','paprika','butter']);
  add('mercimek çorbası', ['mercimek çorbası','mercimek corbasi','mercimek','lentil soup'], 'turkish', ['lentil','onion','carrot','potato','butter','paprika','lemon','salt']);
  add('şakşuka', ['şakşuka','saksuka'], 'turkish', ['eggplant','zucchini','bell pepper','tomato','garlic','olive oil','yogurt']);
  add('imam bayıldı', ['imam bayıldı','imam bayildi'], 'turkish', ['eggplant','onion','tomato','garlic','olive oil','parsley','sugar']);
  add('pilav', ['pilav','türk pilavı','turk pilavi','rice pilaf'], 'turkish', ['rice','butter','chicken stock','salt']);
  // Italian
  add('pasta amatriciana', ['pasta amatriciana','amatriciana','bucatini amatriciana'], 'italian', ['pasta','bacon','tomato sauce','parmesan','black pepper','olive oil','onion']);
  add('carbonara', ['carbonara','spaghetti carbonara'], 'italian', ['pasta','egg','bacon','parmesan','black pepper']);
  add('pasta puttanesca', ['pasta puttanesca','puttanesca'], 'italian', ['pasta','tomato sauce','olives','garlic','chili flakes','olive oil','parsley']);
  add('lasagna', ['lasagna','lasagne'], 'italian', ['pasta','ground beef','tomato sauce','mozzarella','parmesan','ricotta','onion','garlic']);
  add('pasta pomodoro', ['pasta pomodoro','pomodoro'], 'italian', ['pasta','tomato sauce','basil','garlic','olive oil','parmesan']);
  add('pesto pasta', ['pesto pasta','pesto'], 'italian', ['pasta','basil','parmesan','garlic','olive oil','nuts']);
  add('risotto', ['risotto','mushroom risotto'], 'italian', ['rice','mushroom','onion','garlic','parmesan','butter','chicken stock','wine']);
  add('pizza margherita', ['pizza margherita','pizza','margherita'], 'italian', ['flour','mozzarella','tomato sauce','basil','olive oil','salt','yeast']);
  add('caprese', ['caprese','caprese salad'], 'italian', ['tomato','mozzarella','basil','olive oil','balsamic','salt']);
  add('bolognese', ['bolognese','ragu bolognese'], 'italian', ['pasta','ground beef','onion','carrot','celery','tomato sauce','olive oil']);
  // Mediterranean
  add('shakshuka', ['shakshuka'], 'mediterranean', ['egg','tomato','bell pepper','onion','garlic','paprika','cumin','olive oil']);
  add('hummus dish', ['hummus','humus'], 'mediterranean', ['chickpea','tahini','lemon','garlic','olive oil','cumin','salt']);
  add('baba ghanoush', ['baba ghanoush','babaghanoush'], 'mediterranean', ['eggplant','tahini','lemon','garlic','olive oil','parsley']);
  add('tabbouleh', ['tabbouleh','tabule'], 'mediterranean', ['parsley','bulgur','tomato','mint','lemon','olive oil','onion']);
  add('falafel', ['falafel'], 'mediterranean', ['chickpea','parsley','cilantro','garlic','cumin','flour']);
  add('greek salad', ['greek salad','horiatiki'], 'mediterranean', ['tomato','cucumber','onion','feta','olives','oregano','olive oil']);
  add('tzatziki', ['tzatziki','cacık','cacik'], 'mediterranean', ['yogurt','cucumber','garlic','dill','olive oil','salt']);
  add('moussaka', ['moussaka'], 'mediterranean', ['eggplant','ground beef','tomato sauce','onion','garlic','milk','butter','flour','cheese']);
  // Mexican
  add('tacos', ['tacos','taco night'], 'mexican', ['tortilla','ground beef','onion','tomato','lettuce','cheese','lime','cilantro']);
  add('guacamole', ['guacamole','guac'], 'mexican', ['avocado','lime','onion','tomato','cilantro','salt']);
  add('quesadilla', ['quesadilla'], 'mexican', ['tortilla','cheese','butter']);
  add('chili', ['chili','chili con carne'], 'mexican', ['ground beef','black bean','tomato sauce','onion','garlic','cumin','paprika','chili flakes']);
  // Asian
  add('fried rice', ['fried rice'], 'asian', ['rice','egg','soy sauce','garlic','sesame oil','green beans','onion']);
  add('ramen', ['ramen'], 'asian', ['pasta','chicken stock','egg','soy sauce','sesame oil','green beans']);
  add('stir fry', ['stir fry','stirfry'], 'asian', ['chicken','broccoli','bell pepper','garlic','ginger','soy sauce','sesame oil','rice']);
  add('pad thai', ['pad thai'], 'asian', ['pasta','egg','peanut butter','lime','soy sauce','chicken','nuts']);
  // Breakfast
  add('omelet', ['omelet','omelette'], 'breakfast', ['egg','butter','salt','black pepper']);
  add('scrambled eggs', ['scrambled eggs','scramble'], 'breakfast', ['egg','butter','salt','milk']);
  add('pancakes', ['pancakes','pancake'], 'breakfast', ['flour','egg','milk','sugar','butter','salt']);
  add('french toast', ['french toast'], 'breakfast', ['bread','egg','milk','cinnamon','butter','sugar']);
  add('oatmeal', ['oatmeal','porridge'], 'breakfast', ['oats','milk','honey','banana']);
  add('avocado toast', ['avocado toast'], 'breakfast', ['bread','avocado','lemon','salt','chili flakes']);
  // Comfort
  add('grilled cheese', ['grilled cheese'], 'comfort', ['bread','cheese','butter']);
  add('sandwich', ['sandwich','sandvic'], 'comfort', ['bread','cheese','lettuce','tomato','mayo']);
  add('salad', ['salad','mixed salad'], 'comfort', ['lettuce','tomato','cucumber','olive oil','lemon','salt']);
  add('soup', ['soup','vegetable soup'], 'comfort', ['onion','carrot','celery','potato','chicken stock','salt']);
  add('chicken soup', ['chicken soup','tavuk çorbası','tavuk corbasi'], 'comfort', ['chicken','onion','carrot','celery','chicken stock','parsley','salt']);
  add('roast chicken', ['roast chicken','whole chicken'], 'comfort', ['chicken','butter','garlic','lemon','rosemary','salt','black pepper']);
  add('mac and cheese', ['mac and cheese','mac n cheese'], 'comfort', ['pasta','cheese','butter','milk','flour','salt']);
  add('burger', ['burger','hamburger'], 'comfort', ['ground beef','bread','lettuce','tomato','onion','cheese','salt']);
  return R;
}

export const ALIAS_TABLE: AliasTable = buildAliasTable();
export const RECIPE_TABLE: RecipeTable = buildRecipeTable();

// Pre-sorted alias rows: [alias_lower, canonical, word_count, char_length]
export const SORTED_ALIASES: Array<[string, string, number, number]> = (() => {
  const rows: Array<[string, string, number, number]> = [];
  for (const canon of Object.keys(ALIAS_TABLE)) {
    for (const a of ALIAS_TABLE[canon].aliases) {
      const al = a.toLowerCase();
      rows.push([al, canon, al.split(/\s+/).length, al.length]);
    }
  }
  rows.sort((a, b) => b[2] - a[2] || b[3] - a[3]);
  return rows;
})();

export const SORTED_RECIPE_ALIASES: Array<[string, string, number, number]> = (() => {
  const rows: Array<[string, string, number, number]> = [];
  for (const canon of Object.keys(RECIPE_TABLE)) {
    for (const a of RECIPE_TABLE[canon].aliases) {
      const al = a.toLowerCase();
      rows.push([al, canon, al.split(/\s+/).length, al.length]);
    }
  }
  rows.sort((a, b) => b[2] - a[2] || b[3] - a[3]);
  return rows;
})();
