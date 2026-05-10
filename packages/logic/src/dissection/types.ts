/**
 * @ollie/logic/dissection · types
 *
 * Route and Action shapes produced by extract().
 */

export type ModuleName =
  | 'reminders'
  | 'grocery'
  | 'pets'
  | 'finance'
  | 'habits'
  | 'sleep'
  | 'cycle'
  | 'work'
  | 'goals'
  | 'admin'
  | 'astrology'
  | 'body'
  | 'health'
  | 'dump';

export type ActionKind = 'add' | 'log' | 'started' | 'ended' | 'symptom' | 'productUse';

/** An answer-engine response (question input). */
export interface AnswerRoute {
  isAnswer: true;
  type: 'answer';
  text: string;
  lookupModules: ModuleName[];
}

/** A single structured action extracted from a dump. */
export interface Action {
  module: ModuleName;
  action: ActionKind;
  data: string;
  daysAgo?: number;
  productType?: string;
  productCount?: number;
}

export type Route = Action[] | AnswerRoute;

export interface DissectionContext {
  /** Reserved for future: hint to the extractor about the active module. */
  moduleContext?: string;
}
