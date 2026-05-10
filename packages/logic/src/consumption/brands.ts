/**
 * @ollie/logic/consumption · seed brand catalog
 *
 * Hand-curated TR-EU brand list across beverages, food, personal care,
 * skincare, QSR, fashion, retail, telecom. Categorized by category_l1
 * (top-level) + category_l2 (subcategory).
 *
 * Apps can pass a custom brands array to matchBrand() to override or
 * extend. The seed is exported so apps that want "ours + ours" can
 * compose: `matchBrand(text, [...BRAND_SEED, ...customBrands])`.
 */

import type { Brand } from './types';

export const BRAND_SEED: Brand[] = [
  // Beverages
  { key: 'starbucks',      display: 'Starbucks',      aliases: ['starbucks', 'sbux', 'starbux'],                   category_l1: 'beverage',      category_l2: 'coffee' },
  { key: 'nescafe',        display: 'Nescafé',        aliases: ['nescafe', 'nescafé', 'nes cafe'],                 category_l1: 'beverage',      category_l2: 'instant_coffee' },
  { key: 'kahve_dunyasi',  display: 'Kahve Dünyası',  aliases: ['kahve dünyası', 'kahve dunyasi', 'kd'],           category_l1: 'beverage',      category_l2: 'coffee' },
  { key: 'mahmood_coffee', display: 'Mahmood Coffee', aliases: ['mahmood coffee', 'mahmood kahve', 'mahmood'],     category_l1: 'beverage',      category_l2: 'coffee' },
  { key: 'lavazza',        display: 'Lavazza',        aliases: ['lavazza'],                                        category_l1: 'beverage',      category_l2: 'coffee' },
  { key: 'jacobs',         display: 'Jacobs',         aliases: ['jacobs', 'jacobs coffee'],                        category_l1: 'beverage',      category_l2: 'instant_coffee' },
  { key: 'coca_cola',      display: 'Coca-Cola',      aliases: ['coca cola', 'coca-cola', 'coke', 'cola'],         category_l1: 'beverage',      category_l2: 'soda' },
  { key: 'pepsi',          display: 'Pepsi',          aliases: ['pepsi'],                                          category_l1: 'beverage',      category_l2: 'soda' },
  { key: 'fanta',          display: 'Fanta',          aliases: ['fanta'],                                          category_l1: 'beverage',      category_l2: 'soda' },
  { key: 'sprite',         display: 'Sprite',         aliases: ['sprite'],                                         category_l1: 'beverage',      category_l2: 'soda' },
  { key: 'red_bull',       display: 'Red Bull',       aliases: ['red bull', 'redbull'],                            category_l1: 'beverage',      category_l2: 'energy_drink' },
  { key: 'erikli',         display: 'Erikli',         aliases: ['erikli'],                                         category_l1: 'beverage',      category_l2: 'water' },
  { key: 'hayat',          display: 'Hayat',          aliases: ['hayat su'],                                       category_l1: 'beverage',      category_l2: 'water' },
  { key: 'sirma',          display: 'Sırma',          aliases: ['sırma', 'sirma'],                                 category_l1: 'beverage',      category_l2: 'water' },
  { key: 'efes',           display: 'Efes',           aliases: ['efes', 'efes pilsen'],                            category_l1: 'beverage',      category_l2: 'beer' },
  { key: 'tuborg',         display: 'Tuborg',         aliases: ['tuborg'],                                         category_l1: 'beverage',      category_l2: 'beer' },

  // Food
  { key: 'milka',          display: 'Milka',          aliases: ['milka'],                                          category_l1: 'food',          category_l2: 'chocolate' },
  { key: 'toblerone',      display: 'Toblerone',      aliases: ['toblerone'],                                      category_l1: 'food',          category_l2: 'chocolate' },
  { key: 'lindt',          display: 'Lindt',          aliases: ['lindt'],                                          category_l1: 'food',          category_l2: 'chocolate' },
  { key: 'godiva',         display: 'Godiva',         aliases: ['godiva'],                                         category_l1: 'food',          category_l2: 'chocolate' },
  { key: 'ulker',          display: 'Ülker',          aliases: ['ülker', 'ulker'],                                 category_l1: 'food',          category_l2: 'confectionery' },
  { key: 'eti',            display: 'Eti',            aliases: ['eti'],                                            category_l1: 'food',          category_l2: 'confectionery' },
  { key: 'kinder',         display: 'Kinder',         aliases: ['kinder', 'kinder bueno', 'kinder surprise'],      category_l1: 'food',          category_l2: 'chocolate' },
  { key: 'haribo',         display: 'Haribo',         aliases: ['haribo'],                                         category_l1: 'food',          category_l2: 'candy' },
  { key: 'lays',           display: "Lay's",          aliases: ["lay's", 'lays', 'lay s'],                         category_l1: 'food',          category_l2: 'snacks' },
  { key: 'doritos',        display: 'Doritos',        aliases: ['doritos'],                                        category_l1: 'food',          category_l2: 'snacks' },
  { key: 'pringles',       display: 'Pringles',       aliases: ['pringles'],                                       category_l1: 'food',          category_l2: 'snacks' },
  { key: 'pinar',          display: 'Pınar',          aliases: ['pınar', 'pinar'],                                 category_l1: 'food',          category_l2: 'dairy' },
  { key: 'sutas',          display: 'Sütaş',          aliases: ['sütaş', 'sutas'],                                 category_l1: 'food',          category_l2: 'dairy' },
  { key: 'danone',         display: 'Danone',         aliases: ['danone'],                                         category_l1: 'food',          category_l2: 'dairy' },
  { key: 'icim',           display: 'İçim',           aliases: ['içim', 'icim'],                                   category_l1: 'food',          category_l2: 'dairy' },

  // Personal care
  { key: 'nivea',          display: 'Nivea',          aliases: ['nivea'],                                          category_l1: 'personal_care', category_l2: 'body_care' },
  { key: 'dove',           display: 'Dove',           aliases: ['dove'],                                           category_l1: 'personal_care', category_l2: 'body_care' },
  { key: 'garnier',        display: 'Garnier',        aliases: ['garnier'],                                        category_l1: 'personal_care', category_l2: 'hair_care' },
  { key: 'loreal',         display: "L'Oréal",        aliases: ["l'oréal", "l'oreal", 'loreal', 'loréal'],         category_l1: 'personal_care', category_l2: 'hair_care' },
  { key: 'maybelline',     display: 'Maybelline',     aliases: ['maybelline'],                                     category_l1: 'personal_care', category_l2: 'makeup' },

  // Skincare
  { key: 'la_roche_posay', display: 'La Roche-Posay', aliases: ['la roche posay', 'la roche-posay', 'lrp'],        category_l1: 'skincare',      category_l2: 'derma' },
  { key: 'bioderma',       display: 'Bioderma',       aliases: ['bioderma'],                                       category_l1: 'skincare',      category_l2: 'derma' },
  { key: 'eucerin',        display: 'Eucerin',        aliases: ['eucerin'],                                        category_l1: 'skincare',      category_l2: 'derma' },
  { key: 'cerave',         display: 'CeraVe',         aliases: ['cerave', 'cera ve'],                              category_l1: 'skincare',      category_l2: 'derma' },
  { key: 'neutrogena',     display: 'Neutrogena',     aliases: ['neutrogena'],                                     category_l1: 'skincare',      category_l2: 'derma' },
  { key: 'the_ordinary',   display: 'The Ordinary',   aliases: ['the ordinary'],                                   category_l1: 'skincare',      category_l2: 'serum' },

  // QSR
  { key: 'mcdonalds',      display: "McDonald's",     aliases: ['mcdonalds', "mcdonald's", 'mcd'],                 category_l1: 'qsr',           category_l2: 'burger' },
  { key: 'burger_king',    display: 'Burger King',    aliases: ['burger king', 'bk'],                              category_l1: 'qsr',           category_l2: 'burger' },
  { key: 'kfc',            display: 'KFC',            aliases: ['kfc'],                                            category_l1: 'qsr',           category_l2: 'chicken' },
  { key: 'popeyes',        display: 'Popeyes',        aliases: ['popeyes'],                                        category_l1: 'qsr',           category_l2: 'chicken' },
  { key: 'dominos',        display: "Domino's",       aliases: ["domino's", 'dominos'],                            category_l1: 'qsr',           category_l2: 'pizza' },
  { key: 'pizza_hut',      display: 'Pizza Hut',      aliases: ['pizza hut'],                                      category_l1: 'qsr',           category_l2: 'pizza' },
  { key: 'subway',         display: 'Subway',         aliases: ['subway'],                                         category_l1: 'qsr',           category_l2: 'sandwich' },

  // Fashion
  { key: 'zara',           display: 'Zara',           aliases: ['zara'],                                           category_l1: 'fashion',       category_l2: 'apparel' },
  { key: 'mango',          display: 'Mango',          aliases: ['mango'],                                          category_l1: 'fashion',       category_l2: 'apparel' },
  { key: 'hm',             display: 'H&M',            aliases: ['h&m', 'h m'],                                     category_l1: 'fashion',       category_l2: 'apparel' },
  { key: 'lc_waikiki',     display: 'LC Waikiki',     aliases: ['lc waikiki', 'lcw', 'lc-waikiki'],                category_l1: 'fashion',       category_l2: 'apparel' },
  { key: 'koton',          display: 'Koton',          aliases: ['koton'],                                          category_l1: 'fashion',       category_l2: 'apparel' },
  { key: 'mavi',           display: 'Mavi',           aliases: ['mavi jeans'],                                     category_l1: 'fashion',       category_l2: 'apparel' },

  // Retail
  { key: 'migros',         display: 'Migros',         aliases: ['migros'],                                         category_l1: 'retail',        category_l2: 'supermarket' },
  { key: 'carrefour',      display: 'CarrefourSA',    aliases: ['carrefour', 'carrefoursa'],                       category_l1: 'retail',        category_l2: 'supermarket' },
  { key: 'bim',            display: 'BİM',            aliases: ['bim'],                                            category_l1: 'retail',        category_l2: 'discount' },
  { key: 'a101',           display: 'A101',           aliases: ['a101', 'a 101'],                                  category_l1: 'retail',        category_l2: 'discount' },
  { key: 'sok',            display: 'ŞOK',            aliases: ['şok', 'sok market'],                              category_l1: 'retail',        category_l2: 'discount' },
  { key: 'macrocenter',    display: 'Macrocenter',    aliases: ['macrocenter', 'macro center'],                    category_l1: 'retail',        category_l2: 'supermarket' },

  // Telecom
  { key: 'turkcell',       display: 'Turkcell',       aliases: ['turkcell'],                                       category_l1: 'telecom',       category_l2: 'mobile' },
  { key: 'vodafone',       display: 'Vodafone',       aliases: ['vodafone'],                                       category_l1: 'telecom',       category_l2: 'mobile' },
  { key: 'turk_telekom',   display: 'Türk Telekom',   aliases: ['türk telekom', 'turk telekom'],                   category_l1: 'telecom',       category_l2: 'mobile' },
];
