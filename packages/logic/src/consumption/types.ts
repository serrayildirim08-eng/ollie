/**
 * @ollie/logic/consumption · types
 */

export interface Brand {
  key: string;
  display: string;
  aliases: string[];
  category_l1: string;
  category_l2?: string;
}

export interface BrandMatch {
  brand_key: string;
  category_l1: string;
  category_l2: string | null;
  confidence: number;
  matched_token: string;
}
