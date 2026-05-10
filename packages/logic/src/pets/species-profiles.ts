/**
 * @ollie/logic · pets species profiles
 *
 * Pure data — no I/O, no clock reads.
 * Sources: AVMA, RSPCA, Cavy Welfare Society, ReptiFiles, UC Davis SVM.
 */

import type { SpeciesProfiles } from './types';

export const SPECIES_PROFILES: SpeciesProfiles = {

  guinea_pig: {
    display_name: 'guinea pig',
    display_name_plural: 'guinea pigs',
    social_taxonomy: 'prey_animal',
    welfare_flags: { must_pair: true, solo_max_hours: 72, minimum_cage_area_m2: 1.0 },
    care_tasks: {
      hay_refill:    { cadence_days: 2,   critical_days: 4,   source: 'Cavy Welfare Society', source_url: 'https://www.cavywelfare.org/caresheet',                                                    welfare_note: 'guinea pigs need constant access to hay for gut motility — this matters.' },
      cage_clean:    { cadence_days: 3,   critical_days: 7,   source: 'RSPCA',                source_url: 'https://www.rspca.org.uk/adviceandwelfare/pets/rodents/guineapigs/environment',          welfare_note: 'ammonia buildup from a dirty cage causes respiratory infections.' },
      vitamin_c:     { cadence_days: 1,   critical_days: 2,   source: 'UC Davis School of Veterinary Medicine', source_url: 'https://www.vetmed.ucdavis.edu/hospital/small-animal/exotic-companion-small-mammal', welfare_note: 'guinea pigs cannot synthesize vitamin c. deficiency causes scurvy within days.' },
      fresh_veg:     { cadence_days: 1,   critical_days: 3,   source: 'Cavy Welfare Society', source_url: 'https://www.cavywelfare.org/diet',                                                        welfare_note: 'one cup of leafy greens daily provides vitamin c and hydration.' },
      water_refresh: { cadence_days: 1,   critical_days: 2,   source: 'RSPCA',                source_url: 'https://www.rspca.org.uk/adviceandwelfare/pets/rodents/guineapigs/environment',          welfare_note: null },
      nail_trim:     { cadence_days: 30,  critical_days: 60,  source: 'AVMA',                 source_url: 'https://www.avma.org/resources/pet-owners/petcare',                                       welfare_note: 'overgrown nails cause foot injuries.' },
      floor_time:    { cadence_days: 1,   critical_days: 3,   source: 'Cavy Welfare Society', source_url: 'https://www.cavywelfare.org/caresheet',                                                    welfare_note: 'at least 1 hour of supervised out-of-cage time daily.' },
      vet_checkup:   { cadence_days: 180, critical_days: 365, source: 'UC Davis School of Veterinary Medicine', source_url: 'https://www.vetmed.ucdavis.edu/hospital/small-animal/exotic-companion-small-mammal', welfare_note: 'annual exotic-vet checkup; biannual for pigs over 4 years.' },
    },
    bonding: {
      build_rate: 'slow', min_daily_minutes: 20, forget_window_days: 7,
      trust_stages: [
        { stage: 0, name: 'getting acquainted',  observable: ['they freeze when you enter the room'] },
        { stage: 1, name: 'tolerating presence', observable: ['they eat while you are close'] },
        { stage: 2, name: 'accepting hands',     observable: ['they take food from your hand'] },
        { stage: 3, name: 'seeking contact',     observable: ['they wheek when they hear you'] },
        { stage: 4, name: 'comfortable',         observable: ['they popcorn in your presence'] },
        { stage: 5, name: 'bonded',              observable: ['they relax fully on your lap'] },
      ],
    },
    parser_keywords: {
      hay_refill:    [{ kw: 'refilled hay', conf: 0.95 }, { kw: 'new hay', conf: 0.9 }, { kw: 'more hay', conf: 0.85 }, { kw: 'hay bag', conf: 0.7 }, { kw: 'topped up hay', conf: 0.9 }, { kw: 'bought hay', conf: 0.6 }],
      cage_clean:    [{ kw: 'cleaned the cage', conf: 0.95 }, { kw: 'cleaned cage', conf: 0.95 }, { kw: 'fresh bedding', conf: 0.85 }, { kw: 'changed bedding', conf: 0.9 }, { kw: 'scrubbed cage', conf: 0.9 }, { kw: 'spot cleaned', conf: 0.8 }],
      vitamin_c:     [{ kw: 'vitamin c', conf: 0.95 }, { kw: 'vit c', conf: 0.9 }, { kw: 'bell pepper', conf: 0.75 }, { kw: 'pepper', conf: 0.5 }],
      fresh_veg:     [{ kw: 'gave veggies', conf: 0.9 }, { kw: 'fresh greens', conf: 0.9 }, { kw: 'lettuce', conf: 0.75 }, { kw: 'cilantro', conf: 0.8 }, { kw: 'parsley', conf: 0.8 }],
      water_refresh: [{ kw: 'fresh water', conf: 0.9 }, { kw: 'changed water', conf: 0.9 }, { kw: 'water bottle', conf: 0.6 }],
      nail_trim:     [{ kw: 'trimmed nails', conf: 0.95 }, { kw: 'cut nails', conf: 0.9 }, { kw: 'nail clip', conf: 0.85 }],
      floor_time:    [{ kw: 'floor time', conf: 0.95 }, { kw: 'let them out', conf: 0.85 }, { kw: 'out of the cage', conf: 0.8 }, { kw: 'lap time', conf: 0.85 }],
      vet_checkup:   [{ kw: 'vet appointment', conf: 0.9 }, { kw: 'vet visit', conf: 0.9 }, { kw: 'took to the vet', conf: 0.95 }],
    },
    observation_tags: ['popcorning', 'wheeking', 'rumblestrutting', 'purring', 'teeth chattering', 'zoomies'],
    species_terms: ['piggy', 'piggies', 'guinea pig', 'guinea pigs', 'cavy', 'cavies'],
    health_flags: {
      not_eating:  { signals: ['not eating', 'no appetite', 'wont eat', "won't eat", 'refusing food'],  severity: 'urgent',   welfare_note: 'guinea pigs in gut stasis require vet attention within 24–48h.', source_url: 'https://www.vetmed.ucdavis.edu/hospital/small-animal/exotic-companion-small-mammal' },
      hunched:     { signals: ['hunched', 'tucked up', 'puffed'],                                        severity: 'urgent',   welfare_note: 'hunched posture is a pain sign in guinea pigs.',             source_url: 'https://www.rspca.org.uk/adviceandwelfare/pets/rodents/guineapigs/health' },
      respiratory: { signals: ['wheezing', 'sneezing', 'crusty nose', 'runny eye'],                     severity: 'vet_soon', welfare_note: 'upper respiratory infections in guinea pigs progress quickly.',  source_url: 'https://www.vetmed.ucdavis.edu/hospital/small-animal/exotic-companion-small-mammal' },
    },
  },

  rabbit: {
    display_name: 'rabbit',
    display_name_plural: 'rabbits',
    social_taxonomy: 'prey_animal',
    welfare_flags: { must_pair: true, solo_max_hours: 72, minimum_cage_area_m2: 2.0 },
    care_tasks: {
      fresh_hay:     { cadence_days: 1,   critical_days: 2,   source: 'RSPCA', source_url: 'https://www.rspca.org.uk/adviceandwelfare/pets/rabbits',             welfare_note: 'rabbits need constant access to hay — 80% of diet by volume.' },
      litter_change: { cadence_days: 3,   critical_days: 7,   source: 'RSPCA', source_url: 'https://www.rspca.org.uk/adviceandwelfare/pets/rabbits',             welfare_note: 'dirty litter irritates rabbit respiratory systems.' },
      fresh_veg:     { cadence_days: 1,   critical_days: 3,   source: 'RSPCA', source_url: 'https://www.rspca.org.uk/adviceandwelfare/pets/rabbits',             welfare_note: 'leafy greens provide hydration and micronutrients.' },
      water_refresh: { cadence_days: 1,   critical_days: 2,   source: 'RSPCA', source_url: 'https://www.rspca.org.uk/adviceandwelfare/pets/rabbits',             welfare_note: null },
      nail_trim:     { cadence_days: 45,  critical_days: 90,  source: 'AVMA',  source_url: 'https://www.avma.org/resources/pet-owners/petcare',                  welfare_note: 'overgrown nails cause joint strain.' },
      floor_time:    { cadence_days: 1,   critical_days: 3,   source: 'RSPCA', source_url: 'https://www.rspca.org.uk/adviceandwelfare/pets/rabbits/environment', welfare_note: 'minimum 3 hours of out-of-pen time daily for welfare.' },
      vet_checkup:   { cadence_days: 365, critical_days: 540, source: 'AVMA',  source_url: 'https://www.avma.org/resources/pet-owners/petcare',                  welfare_note: null },
    },
    bonding: {
      build_rate: 'slow', min_daily_minutes: 30, forget_window_days: 5,
      trust_stages: [
        { stage: 0, name: 'wary',        observable: ['they thump when you approach'] },
        { stage: 1, name: 'neutral',     observable: ['they eat in your presence'] },
        { stage: 2, name: 'comfortable', observable: ['they flop near you'] },
        { stage: 3, name: 'bonded',      observable: ['they binky when they see you'] },
      ],
    },
    parser_keywords: {
      fresh_hay:     [{ kw: 'fresh hay', conf: 0.95 }, { kw: 'topped up hay', conf: 0.9 }, { kw: 'new hay', conf: 0.85 }],
      litter_change: [{ kw: 'litter change', conf: 0.95 }, { kw: 'changed litter', conf: 0.95 }, { kw: 'cleaned litter', conf: 0.9 }],
      fresh_veg:     [{ kw: 'fresh veggies', conf: 0.9 }, { kw: 'greens', conf: 0.8 }, { kw: 'lettuce', conf: 0.75 }],
      water_refresh: [{ kw: 'fresh water', conf: 0.9 }, { kw: 'changed water', conf: 0.9 }, { kw: 'water bowl', conf: 0.7 }],
      nail_trim:     [{ kw: 'trimmed nails', conf: 0.95 }, { kw: 'cut nails', conf: 0.9 }, { kw: 'nail clip', conf: 0.85 }],
      floor_time:    [{ kw: 'let out to run', conf: 0.9 }, { kw: 'out of the pen', conf: 0.85 }, { kw: 'free roam', conf: 0.85 }],
      vet_checkup:   [{ kw: 'vet visit', conf: 0.9 }, { kw: 'vet appointment', conf: 0.9 }, { kw: 'took to the vet', conf: 0.95 }],
    },
    observation_tags: ['binky', 'flop', 'zoomies', 'thumping', 'nose bonk'],
    species_terms: ['bunny', 'bunnies', 'rabbit', 'rabbits'],
    health_flags: {
      not_eating: { signals: ['not eating', 'refusing food', 'no appetite'], severity: 'urgent',   welfare_note: 'rabbit gi stasis is life-threatening within 12 hours.', source_url: 'https://rabbit.org/faq-gi-stasis/' },
      drooling:   { signals: ['drooling', 'wet chin'],                       severity: 'vet_soon', welfare_note: 'drooling in rabbits usually indicates dental disease.',    source_url: 'https://rabbit.org/faq-malocclusion/' },
    },
  },

  cat: {
    display_name: 'cat',
    display_name_plural: 'cats',
    social_taxonomy: 'independent',
    welfare_flags: { must_pair: false, solo_max_hours: 24, minimum_cage_area_m2: null },
    care_tasks: {
      feed:          { cadence_days: 1,   critical_days: 2,   source: 'AVMA', source_url: 'https://www.avma.org/resources/pet-owners/petcare', welfare_note: null },
      water_refresh: { cadence_days: 1,   critical_days: 2,   source: 'AVMA', source_url: 'https://www.avma.org/resources/pet-owners/petcare', welfare_note: null },
      litter_change: { cadence_days: 1,   critical_days: 3,   source: 'AVMA', source_url: 'https://www.avma.org/resources/pet-owners/petcare', welfare_note: 'cats refuse dirty litter; health and behavior both suffer.' },
      habitat_clean: { cadence_days: 7,   critical_days: 14,  source: 'AVMA', source_url: 'https://www.avma.org/resources/pet-owners/petcare', welfare_note: null },
      vet_checkup:   { cadence_days: 365, critical_days: 540, source: 'AVMA', source_url: 'https://www.avma.org/resources/pet-owners/petcare', welfare_note: 'annual exam baseline; senior cats every 6 months.' },
    },
    bonding: {
      build_rate: 'variable', min_daily_minutes: 15, forget_window_days: 14,
      trust_stages: [
        { stage: 0, name: 'aloof',      observable: ['they avoid the room you enter'] },
        { stage: 1, name: 'neutral',    observable: ['they acknowledge you silently'] },
        { stage: 2, name: 'interested', observable: ['they seek out attention'] },
        { stage: 3, name: 'bonded',     observable: ['they knead or purr when near you'] },
      ],
    },
    parser_keywords: {
      feed:          [{ kw: 'fed', conf: 0.9 }, { kw: 'dinner', conf: 0.75 }, { kw: 'kibble', conf: 0.85 }, { kw: 'wet food', conf: 0.85 }],
      water_refresh: [{ kw: 'fresh water', conf: 0.9 }, { kw: 'changed water', conf: 0.9 }, { kw: 'water fountain', conf: 0.8 }],
      litter_change: [{ kw: 'scooped litter', conf: 0.95 }, { kw: 'cleaned litter', conf: 0.9 }, { kw: 'changed litter', conf: 0.95 }],
      habitat_clean: [{ kw: 'cleaned bed', conf: 0.8 }, { kw: 'washed bedding', conf: 0.85 }],
      vet_checkup:   [{ kw: 'vet appointment', conf: 0.9 }, { kw: 'took to the vet', conf: 0.95 }],
    },
    observation_tags: ['purring', 'kneading', 'slow blink', 'chirping', 'zoomies'],
    species_terms: ['cat', 'cats', 'kitty', 'kitten', 'kitties'],
    health_flags: {
      not_eating: { signals: ['not eating', 'wont eat', "won't eat", 'no appetite'], severity: 'vet_soon', welfare_note: 'cats who stop eating for >24h risk hepatic lipidosis.',               source_url: 'https://www.avma.org/resources/pet-owners/petcare' },
      straining:  { signals: ['straining in litter', 'not urinating', 'cant pee', "can't pee"],           severity: 'urgent',   welfare_note: 'urinary obstruction in male cats is a medical emergency.', source_url: 'https://www.avma.org/resources/pet-owners/petcare' },
    },
  },

  dog: {
    display_name: 'dog',
    display_name_plural: 'dogs',
    social_taxonomy: 'pack',
    welfare_flags: { must_pair: false, solo_max_hours: 8, minimum_cage_area_m2: null },
    care_tasks: {
      feed:          { cadence_days: 1,   critical_days: 2,   source: 'AVMA',  source_url: 'https://www.avma.org/resources/pet-owners/petcare',               welfare_note: null },
      water_refresh: { cadence_days: 1,   critical_days: 1,   source: 'AVMA',  source_url: 'https://www.avma.org/resources/pet-owners/petcare',               welfare_note: null },
      walk:          { cadence_days: 1,   critical_days: 2,   source: 'RSPCA', source_url: 'https://www.rspca.org.uk/adviceandwelfare/pets/dogs/exercise',     welfare_note: 'at least 30 minutes of daily exercise; more for working breeds.' },
      habitat_clean: { cadence_days: 7,   critical_days: 14,  source: 'AVMA',  source_url: 'https://www.avma.org/resources/pet-owners/petcare',               welfare_note: null },
      vet_checkup:   { cadence_days: 365, critical_days: 540, source: 'AVMA',  source_url: 'https://www.avma.org/resources/pet-owners/petcare',               welfare_note: null },
    },
    bonding: {
      build_rate: 'fast', min_daily_minutes: 30, forget_window_days: 2,
      trust_stages: [
        { stage: 0, name: 'uncertain',    observable: ['they watch you from a distance'] },
        { stage: 1, name: 'warming up',   observable: ['they approach on their own'] },
        { stage: 2, name: 'affectionate', observable: ['they seek physical closeness'] },
        { stage: 3, name: 'bonded',       observable: ['they rest calmly while you move'] },
      ],
    },
    parser_keywords: {
      feed:          [{ kw: 'fed', conf: 0.9 }, { kw: 'kibble', conf: 0.85 }, { kw: 'breakfast', conf: 0.7 }, { kw: 'dinner', conf: 0.7 }],
      water_refresh: [{ kw: 'fresh water', conf: 0.9 }, { kw: 'changed water', conf: 0.9 }],
      walk:          [{ kw: 'walked', conf: 0.95 }, { kw: 'went for a walk', conf: 0.95 }, { kw: 'dog park', conf: 0.85 }],
      habitat_clean: [{ kw: 'washed bed', conf: 0.85 }, { kw: 'cleaned crate', conf: 0.9 }],
      vet_checkup:   [{ kw: 'vet appointment', conf: 0.9 }, { kw: 'vet visit', conf: 0.9 }],
    },
    observation_tags: ['zoomies', 'play bow', 'tail wag', 'leaning in'],
    species_terms: ['dog', 'dogs', 'pup', 'puppy', 'puppies'],
    health_flags: {
      not_eating: { signals: ['not eating', 'wont eat', "won't eat", 'no appetite'], severity: 'vet_soon', welfare_note: 'appetite loss >24h in dogs warrants vet attention.',       source_url: 'https://www.avma.org/resources/pet-owners/petcare' },
      vomiting:   { signals: ['vomiting', 'throwing up', 'puking'],                   severity: 'vet_soon', welfare_note: 'repeated vomiting can signal obstruction or toxicity.', source_url: 'https://www.avma.org/resources/pet-owners/petcare' },
    },
  },

  hamster: {
    display_name: 'syrian hamster',
    display_name_plural: 'syrian hamsters',
    social_taxonomy: 'solitary',
    welfare_flags: { must_pair: false, solo_max_hours: null, minimum_cage_area_m2: 0.5 },
    care_tasks: {
      feed:          { cadence_days: 1,   critical_days: 2,   source: 'RSPCA', source_url: 'https://www.rspca.org.uk/adviceandwelfare/pets/rodents/hamsters', welfare_note: null },
      water_refresh: { cadence_days: 1,   critical_days: 2,   source: 'RSPCA', source_url: 'https://www.rspca.org.uk/adviceandwelfare/pets/rodents/hamsters', welfare_note: null },
      habitat_clean: { cadence_days: 10,  critical_days: 21,  source: 'RSPCA', source_url: 'https://www.rspca.org.uk/adviceandwelfare/pets/rodents/hamsters', welfare_note: 'over-cleaning stresses hamsters; partial clean weekly, full clean monthly.' },
      wheel_check:   { cadence_days: 7,   critical_days: 14,  source: 'RSPCA', source_url: 'https://www.rspca.org.uk/adviceandwelfare/pets/rodents/hamsters', welfare_note: 'check wheel for wear; hamsters need a silent wheel >= 28cm diameter.' },
      vet_checkup:   { cadence_days: 180, critical_days: 365, source: 'AVMA',  source_url: 'https://www.avma.org/resources/pet-owners/petcare',               welfare_note: null },
    },
    bonding: {
      build_rate: 'slow', min_daily_minutes: 10, forget_window_days: 3,
      trust_stages: [
        { stage: 0, name: 'wary',      observable: ['they hide when you approach'] },
        { stage: 1, name: 'curious',   observable: ['they sniff the air when you speak'] },
        { stage: 2, name: 'hand-tame', observable: ['they climb onto your palm for food'] },
        { stage: 3, name: 'bonded',    observable: ['they sit calmly while being held briefly'] },
      ],
    },
    parser_keywords: {
      feed:          [{ kw: 'fed hamster', conf: 0.9 }, { kw: 'gave seeds', conf: 0.8 }, { kw: 'food bowl', conf: 0.7 }],
      water_refresh: [{ kw: 'fresh water', conf: 0.9 }, { kw: 'changed water', conf: 0.9 }],
      habitat_clean: [{ kw: 'cleaned tank', conf: 0.9 }, { kw: 'cleaned cage', conf: 0.9 }, { kw: 'spot cleaned', conf: 0.8 }],
      wheel_check:   [{ kw: 'wheel check', conf: 0.95 }, { kw: 'oiled wheel', conf: 0.9 }],
      vet_checkup:   [{ kw: 'vet appointment', conf: 0.9 }, { kw: 'vet visit', conf: 0.9 }],
    },
    observation_tags: ['stuffing cheeks', 'burrowing', 'running the wheel'],
    species_terms: ['hamster', 'hamsters'],
    health_flags: {
      wet_tail: { signals: ['wet tail', 'diarrhea', 'wet bottom'], severity: 'urgent',   welfare_note: 'wet tail in hamsters is rapidly fatal without vet treatment.', source_url: 'https://www.rspca.org.uk/adviceandwelfare/pets/rodents/hamsters' },
      lethargy: { signals: ['not moving', 'lethargic', 'sleepy during evening'],          severity: 'vet_soon', welfare_note: 'hamsters are crepuscular — evening lethargy is abnormal.',   source_url: 'https://www.rspca.org.uk/adviceandwelfare/pets/rodents/hamsters' },
    },
  },

  rat: {
    display_name: 'rat',
    display_name_plural: 'rats',
    social_taxonomy: 'pack',
    welfare_flags: { must_pair: true, solo_max_hours: 48, minimum_cage_area_m2: 0.8 },
    care_tasks: {
      feed:          { cadence_days: 1,   critical_days: 2,   source: 'RSPCA', source_url: 'https://www.rspca.org.uk/adviceandwelfare/pets/rodents/rats', welfare_note: null },
      water_refresh: { cadence_days: 1,   critical_days: 2,   source: 'RSPCA', source_url: 'https://www.rspca.org.uk/adviceandwelfare/pets/rodents/rats', welfare_note: null },
      habitat_clean: { cadence_days: 5,   critical_days: 10,  source: 'RSPCA', source_url: 'https://www.rspca.org.uk/adviceandwelfare/pets/rodents/rats', welfare_note: 'rats need clean air — ammonia damages their respiratory system.' },
      floor_time:    { cadence_days: 1,   critical_days: 3,   source: 'RSPCA', source_url: 'https://www.rspca.org.uk/adviceandwelfare/pets/rodents/rats', welfare_note: 'at least 1 hour of supervised free-roam daily.' },
      vet_checkup:   { cadence_days: 180, critical_days: 365, source: 'AVMA',  source_url: 'https://www.avma.org/resources/pet-owners/petcare',           welfare_note: null },
    },
    bonding: {
      build_rate: 'fast', min_daily_minutes: 20, forget_window_days: 3,
      trust_stages: [
        { stage: 0, name: 'uncertain', observable: ['they keep their distance'] },
        { stage: 1, name: 'warming',   observable: ['they climb out of the cage to meet you'] },
        { stage: 2, name: 'social',    observable: ['they ride on your shoulder'] },
        { stage: 3, name: 'bonded',    observable: ['they seek out grooming from you'] },
      ],
    },
    parser_keywords: {
      feed:          [{ kw: 'fed rats', conf: 0.9 }, { kw: 'rat food', conf: 0.8 }],
      water_refresh: [{ kw: 'fresh water', conf: 0.9 }, { kw: 'changed water', conf: 0.9 }],
      habitat_clean: [{ kw: 'cleaned rat cage', conf: 0.95 }, { kw: 'spot cleaned', conf: 0.8 }],
      floor_time:    [{ kw: 'free roam', conf: 0.9 }, { kw: 'let them out', conf: 0.85 }],
      vet_checkup:   [{ kw: 'vet visit', conf: 0.9 }, { kw: 'vet appointment', conf: 0.9 }],
    },
    observation_tags: ['bruxing', 'boggling', 'teeth grinding', 'play fighting'],
    species_terms: ['rat', 'rats'],
    health_flags: {
      respiratory: { signals: ['wheezing', 'sneezing', 'clicking', 'porphyrin'], severity: 'vet_soon', welfare_note: 'myco is the most common cause of rat illness; early vet treatment matters.', source_url: 'https://ratguide.com/health/respiratory/mycoplasmosis.php' },
      tumors:      { signals: ['lump', 'growth', 'mass'],                         severity: 'vet_soon', welfare_note: 'mammary tumors are common; early removal improves outcomes.',              source_url: 'https://ratguide.com/health/tumors/mammary.php' },
    },
  },

  bearded_dragon: {
    display_name: 'bearded dragon',
    display_name_plural: 'bearded dragons',
    social_taxonomy: 'solitary_reptile',
    welfare_flags: { must_pair: false, solo_max_hours: null, minimum_cage_area_m2: 1.5 },
    care_tasks: {
      feed:           { cadence_days: 1,   critical_days: 2,   source: 'ReptiFiles', source_url: 'https://reptifiles.com/bearded-dragon-care/',              welfare_note: 'juveniles need daily insects; adults alternate days.' },
      water_refresh:  { cadence_days: 1,   critical_days: 2,   source: 'ReptiFiles', source_url: 'https://reptifiles.com/bearded-dragon-care/',              welfare_note: null },
      habitat_clean:  { cadence_days: 7,   critical_days: 14,  source: 'ReptiFiles', source_url: 'https://reptifiles.com/bearded-dragon-care/',              welfare_note: null },
      uvb_bulb_check: { cadence_days: 14,  critical_days: 30,  source: 'ReptiFiles', source_url: 'https://reptifiles.com/bearded-dragon-care/uvb-lighting/', welfare_note: 'uvb output drops long before the bulb visibly fails; replace every 6 months.' },
      basking_temp:   { cadence_days: 2,   critical_days: 5,   source: 'ReptiFiles', source_url: 'https://reptifiles.com/bearded-dragon-care/temperatures/', welfare_note: 'basking spot 95–110°F; cool side 75–85°F. without heat they cannot digest.' },
      vet_checkup:    { cadence_days: 365, critical_days: 540, source: 'AVMA',       source_url: 'https://www.avma.org/resources/pet-owners/petcare',        welfare_note: null },
    },
    bonding: {
      build_rate: 'slow', min_daily_minutes: 10, forget_window_days: 14,
      trust_stages: [
        { stage: 0, name: 'tolerant',    observable: ['they allow proximity'] },
        { stage: 1, name: 'familiar',    observable: ['they accept handling without puffing'] },
        { stage: 2, name: 'comfortable', observable: ['they close their eyes when held'] },
      ],
    },
    parser_keywords: {
      feed:           [{ kw: 'fed beardie', conf: 0.9 }, { kw: 'crickets', conf: 0.85 }, { kw: 'dubias', conf: 0.85 }],
      water_refresh:  [{ kw: 'fresh water', conf: 0.9 }, { kw: 'water dish', conf: 0.8 }],
      habitat_clean:  [{ kw: 'cleaned tank', conf: 0.9 }, { kw: 'cleaned viv', conf: 0.9 }],
      uvb_bulb_check: [{ kw: 'new uvb', conf: 0.95 }, { kw: 'replaced uvb', conf: 0.95 }, { kw: 'uvb bulb', conf: 0.8 }],
      basking_temp:   [{ kw: 'checked temps', conf: 0.9 }, { kw: 'basking temp', conf: 0.95 }],
      vet_checkup:    [{ kw: 'vet visit', conf: 0.9 }, { kw: 'exotic vet', conf: 0.9 }],
    },
    observation_tags: ['glass surfing', 'arm waving', 'beard puffing', 'brumating'],
    species_terms: ['beardie', 'beardies', 'bearded dragon', 'bearded dragons'],
    health_flags: {
      not_eating:  { signals: ['not eating', 'refusing food', 'no appetite'], severity: 'vet_soon', welfare_note: 'in cooler months brumation is normal; year-round anorexia is not.',  source_url: 'https://reptifiles.com/bearded-dragon-care/' },
      black_beard: { signals: ['black beard', 'beard puffing constantly'],     severity: 'vet_soon', welfare_note: 'persistent black beard signals chronic stress or illness.',           source_url: 'https://reptifiles.com/bearded-dragon-care/' },
    },
  },

  leopard_gecko: {
    display_name: 'leopard gecko',
    display_name_plural: 'leopard geckos',
    social_taxonomy: 'solitary_reptile',
    welfare_flags: { must_pair: false, solo_max_hours: null, minimum_cage_area_m2: 0.5 },
    care_tasks: {
      feed:                 { cadence_days: 2,   critical_days: 5,   source: 'ReptiFiles', source_url: 'https://reptifiles.com/leopard-gecko-care/',              welfare_note: 'juveniles every 1–2 days; adults every 2–4 days.' },
      water_refresh:        { cadence_days: 1,   critical_days: 2,   source: 'ReptiFiles', source_url: 'https://reptifiles.com/leopard-gecko-care/',              welfare_note: null },
      habitat_clean:        { cadence_days: 7,   critical_days: 14,  source: 'ReptiFiles', source_url: 'https://reptifiles.com/leopard-gecko-care/',              welfare_note: null },
      basking_temp:         { cadence_days: 2,   critical_days: 5,   source: 'ReptiFiles', source_url: 'https://reptifiles.com/leopard-gecko-care/temperatures/', welfare_note: 'warm hide 88–92°F; cool side 72–78°F.' },
      substrate_spot_clean: { cadence_days: 2,   critical_days: 5,   source: 'ReptiFiles', source_url: 'https://reptifiles.com/leopard-gecko-care/',              welfare_note: 'leos designate toilet corners — spot-clean them.' },
      vet_checkup:          { cadence_days: 365, critical_days: 540, source: 'AVMA',       source_url: 'https://www.avma.org/resources/pet-owners/petcare',       welfare_note: null },
    },
    bonding: {
      build_rate: 'slow', min_daily_minutes: 5, forget_window_days: 14,
      trust_stages: [
        { stage: 0, name: 'skittish',  observable: ['they bolt when the enclosure opens'] },
        { stage: 1, name: 'observing', observable: ['they watch you from their hide'] },
        { stage: 2, name: 'calm',      observable: ['they tolerate short handling'] },
      ],
    },
    parser_keywords: {
      feed:                 [{ kw: 'fed gecko', conf: 0.95 }, { kw: 'crickets', conf: 0.85 }, { kw: 'mealworms', conf: 0.85 }],
      water_refresh:        [{ kw: 'fresh water', conf: 0.9 }, { kw: 'water dish', conf: 0.8 }],
      habitat_clean:        [{ kw: 'cleaned tank', conf: 0.9 }],
      basking_temp:         [{ kw: 'checked temps', conf: 0.9 }, { kw: 'warm hide', conf: 0.85 }],
      substrate_spot_clean: [{ kw: 'spot cleaned', conf: 0.9 }, { kw: 'scooped poop', conf: 0.85 }],
      vet_checkup:          [{ kw: 'exotic vet', conf: 0.9 }, { kw: 'vet visit', conf: 0.9 }],
    },
    observation_tags: ['tail wag', 'calling', 'shedding'],
    species_terms: ['leo', 'leos', 'leopard gecko', 'leopard geckos', 'gecko'],
    health_flags: {
      not_eating: { signals: ['not eating', 'refusing food'], severity: 'vet_soon', welfare_note: 'chronic anorexia in leos requires vet workup.',             source_url: 'https://reptifiles.com/leopard-gecko-care/' },
      stuck_shed: { signals: ['stuck shed', 'shed retained', 'shed on toes'], severity: 'watch', welfare_note: 'retained shed on toes can cut off circulation.', source_url: 'https://reptifiles.com/leopard-gecko-care/' },
    },
  },

  parakeet: {
    display_name: 'budgie',
    display_name_plural: 'budgies',
    social_taxonomy: 'flock',
    welfare_flags: { must_pair: true, solo_max_hours: 8, minimum_cage_area_m2: 0.5 },
    care_tasks: {
      feed:             { cadence_days: 1,   critical_days: 2,   source: 'RSPCA', source_url: 'https://www.rspca.org.uk/adviceandwelfare/pets/birds', welfare_note: null },
      water_refresh:    { cadence_days: 1,   critical_days: 2,   source: 'RSPCA', source_url: 'https://www.rspca.org.uk/adviceandwelfare/pets/birds', welfare_note: 'change water daily; bird droppings contaminate fast.' },
      habitat_clean:    { cadence_days: 3,   critical_days: 7,   source: 'RSPCA', source_url: 'https://www.rspca.org.uk/adviceandwelfare/pets/birds', welfare_note: null },
      cuttlebone_check: { cadence_days: 14,  critical_days: 30,  source: 'RSPCA', source_url: 'https://www.rspca.org.uk/adviceandwelfare/pets/birds', welfare_note: 'calcium via cuttlebone prevents egg-laying issues.' },
      floor_time:       { cadence_days: 1,   critical_days: 3,   source: 'RSPCA', source_url: 'https://www.rspca.org.uk/adviceandwelfare/pets/birds', welfare_note: 'minimum 1 hour of out-of-cage flight per day.' },
      vet_checkup:      { cadence_days: 365, critical_days: 540, source: 'AVMA',  source_url: 'https://www.avma.org/resources/pet-owners/petcare',   welfare_note: null },
    },
    bonding: {
      build_rate: 'fast', min_daily_minutes: 20, forget_window_days: 4,
      trust_stages: [
        { stage: 0, name: 'wary',    observable: ['they edge away when you approach'] },
        { stage: 1, name: 'curious', observable: ['they chirp back when you speak'] },
        { stage: 2, name: 'step-up', observable: ['they step onto your finger'] },
        { stage: 3, name: 'bonded',  observable: ['they sit on your shoulder willingly'] },
      ],
    },
    parser_keywords: {
      feed:             [{ kw: 'fed budgies', conf: 0.95 }, { kw: 'seed mix', conf: 0.8 }, { kw: 'millet', conf: 0.8 }],
      water_refresh:    [{ kw: 'fresh water', conf: 0.9 }, { kw: 'changed water', conf: 0.9 }],
      habitat_clean:    [{ kw: 'cleaned cage', conf: 0.9 }],
      cuttlebone_check: [{ kw: 'cuttlebone', conf: 0.95 }, { kw: 'mineral block', conf: 0.85 }],
      floor_time:       [{ kw: 'let them fly', conf: 0.9 }, { kw: 'out of cage', conf: 0.85 }],
      vet_checkup:      [{ kw: 'avian vet', conf: 0.95 }, { kw: 'vet visit', conf: 0.9 }],
    },
    observation_tags: ['preening', 'singing', 'head bobbing', 'chattering'],
    species_terms: ['budgie', 'budgies', 'parakeet', 'parakeets'],
    health_flags: {
      fluffed:    { signals: ['fluffed up', 'puffy', 'staying fluffed'], severity: 'vet_soon', welfare_note: 'prolonged fluffing indicates illness — birds hide sickness.',   source_url: 'https://www.rspca.org.uk/adviceandwelfare/pets/birds' },
      not_flying: { signals: ['not flying', 'on floor of cage', 'sitting on bottom'], severity: 'urgent', welfare_note: 'a bird on the cage floor is critically ill.', source_url: 'https://www.rspca.org.uk/adviceandwelfare/pets/birds' },
    },
  },

  betta_fish: {
    display_name: 'betta',
    display_name_plural: 'bettas',
    social_taxonomy: 'solitary_fish',
    welfare_flags: { must_pair: false, solo_max_hours: null, minimum_cage_area_m2: null },
    care_tasks: {
      feed:              { cadence_days: 1,  critical_days: 3,  source: 'AVMA', source_url: 'https://www.avma.org/resources/pet-owners/petcare', welfare_note: 'small portions twice daily; fast one day per week.' },
      tank_water_change: { cadence_days: 7,  critical_days: 14, source: 'AVMA', source_url: 'https://www.avma.org/resources/pet-owners/petcare', welfare_note: '25% water change weekly; ammonia is lethal to bettas.' },
      water_test:        { cadence_days: 7,  critical_days: 21, source: 'AVMA', source_url: 'https://www.avma.org/resources/pet-owners/petcare', welfare_note: 'test for ammonia, nitrite, nitrate; early signs of cycling problems.' },
      filter_check:      { cadence_days: 30, critical_days: 60, source: 'AVMA', source_url: 'https://www.avma.org/resources/pet-owners/petcare', welfare_note: null },
      habitat_clean:     { cadence_days: 30, critical_days: 60, source: 'AVMA', source_url: 'https://www.avma.org/resources/pet-owners/petcare', welfare_note: 'avoid full substrate removal — you lose the biofilter.' },
      vet_checkup:       { cadence_days: 365, critical_days: 540, source: 'AVMA', source_url: 'https://www.avma.org/resources/pet-owners/petcare', welfare_note: 'aquatic vets are rare; a local fish store owner can triage for common issues.' },
    },
    bonding: {
      build_rate: 'fast', min_daily_minutes: 5, forget_window_days: 2,
      trust_stages: [
        { stage: 0, name: 'unfamiliar', observable: ['they hide when you approach the tank'] },
        { stage: 1, name: 'aware',      observable: ['they swim to the front when you arrive'] },
        { stage: 2, name: 'responsive', observable: ['they follow your finger across the glass'] },
      ],
    },
    parser_keywords: {
      feed:              [{ kw: 'fed betta', conf: 0.95 }, { kw: 'pellets', conf: 0.8 }, { kw: 'bloodworms', conf: 0.85 }],
      tank_water_change: [{ kw: 'water change', conf: 0.95 }, { kw: 'siphoned', conf: 0.9 }],
      water_test:        [{ kw: 'tested water', conf: 0.95 }, { kw: 'ammonia check', conf: 0.9 }],
      filter_check:      [{ kw: 'cleaned filter', conf: 0.9 }],
      habitat_clean:     [{ kw: 'cleaned tank', conf: 0.9 }],
      vet_checkup:       [{ kw: 'fish vet', conf: 0.9 }],
    },
    observation_tags: ['flaring', 'bubble nest', 'hiding', 'swimming fast'],
    species_terms: ['betta', 'bettas', 'betta fish', 'fish'],
    health_flags: {
      lethargy:    { signals: ['floating sideways', 'lethargic', 'resting on bottom'], severity: 'urgent',   welfare_note: 'may indicate swim bladder or water quality crash.', source_url: 'https://www.avma.org/resources/pet-owners/petcare' },
      clamped_fins: { signals: ['clamped fins', 'fins tight', 'torn fins'],            severity: 'vet_soon', welfare_note: 'fin issues are water-quality signals or fin rot.',   source_url: 'https://www.avma.org/resources/pet-owners/petcare' },
    },
  },
};

export const SPECIES_LIST = Object.keys(SPECIES_PROFILES);

/** Species-adaptive vocabulary — one term per species, rotated by ISO week. */
export const SPECIES_VOCAB: Record<string, Array<{ term: string; gloss: string }>> = {
  guinea_pig: [
    { term: 'wheeking',         gloss: 'high-pitched squeal for food. use it in a brain dump and it logs as an observation.' },
    { term: 'popcorning',       gloss: 'jumping straight up from joy. the clearest welfare signal a pig can give.' },
    { term: 'rumblestrutting',  gloss: 'low rumble + wide stance. usually social or territorial.' },
    { term: 'teeth chattering', gloss: 'warning. usually between pigs. not a cute noise.' },
    { term: 'zoomies',          gloss: 'fast laps around the cage. the cousin of popcorning.' },
    { term: 'purring',          gloss: 'content low vibration when held or stroked.' },
  ],
  rabbit: [
    { term: 'binky',     gloss: 'jumping and twisting mid-air out of pure joy. we parse it.' },
    { term: 'flop',      gloss: 'sudden sideways collapse. peak rabbit-trust.' },
    { term: 'thumping',  gloss: 'warning signal. they heard or felt something wrong.' },
    { term: 'nose bonk', gloss: 'tapping you with their nose. asking, demanding, greeting.' },
  ],
  cat: [
    { term: 'kneading',   gloss: 'pressing paws rhythmically. comfort behavior from kittenhood.' },
    { term: 'slow blink', gloss: 'cat-to-human "i trust you". return it.' },
    { term: 'chirping',   gloss: 'the strange bird-call cats make at prey or interesting things.' },
    { term: 'purring',    gloss: 'can mean content, but also self-soothing when unwell.' },
  ],
  dog: [
    { term: 'play bow',   gloss: "front legs down, rear up. \"let's play.\" universal dog." },
    { term: 'zoomies',    gloss: 'sudden sprints. energy release. more common after a bath.' },
    { term: 'leaning in', gloss: 'pressing against you. social cohesion, not dominance.' },
  ],
  hamster: [
    { term: 'stuffing cheeks',  gloss: "packing food to hoard. never pull it out — it's normal." },
    { term: 'burrowing',        gloss: 'deep tunneling in bedding. a welfare requirement, not a quirk.' },
    { term: 'running the wheel', gloss: 'they can run several km per night. the wheel must be silent.' },
  ],
  rat: [
    { term: 'bruxing',      gloss: 'soft teeth grinding. content. usually with eye-boggling.' },
    { term: 'boggling',     gloss: 'eyes pop in and out. paired with deep bruxing. peak comfort.' },
    { term: 'play fighting', gloss: 'squeaks and rolls. healthy social behavior.' },
  ],
  bearded_dragon: [
    { term: 'arm waving',   gloss: 'slow front-leg wave. submissive, "i see you."' },
    { term: 'glass surfing', gloss: 'scratching at the glass. stress signal — usually too small an enclosure.' },
    { term: 'black beard',   gloss: 'darkened throat. stress, illness, or territorial.' },
    { term: 'brumating',     gloss: 'reptile version of hibernation. normal in cooler months.' },
  ],
  leopard_gecko: [
    { term: 'tail wag', gloss: 'slow = stalking prey. fast = defensive.' },
    { term: 'calling',  gloss: 'small vocalizations. usually a juvenile or breeding signal.' },
    { term: 'shedding', gloss: 'every 4-6 weeks. they eat the shed. leave them to it.' },
  ],
  parakeet: [
    { term: 'preening',     gloss: 'grooming feathers. healthy birds do it constantly.' },
    { term: 'head bobbing', gloss: 'begging or displaying. young birds especially.' },
    { term: 'chattering',   gloss: 'soft continuous vocal. content and social.' },
  ],
  betta_fish: [
    { term: 'flaring',      gloss: 'gills fan out, fins spread. territorial display — short bursts only.' },
    { term: 'bubble nest',  gloss: 'surface bubbles near the top. healthy, breeding-ready male sign.' },
    { term: 'swimming fast', gloss: 'can mean alarm or tank current too strong. check the filter.' },
  ],
};
