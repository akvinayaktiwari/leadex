// Fixed industry list for company profiles, so segment filters match exact values.
export const INDUSTRIES = [
  'software', 'it_services', 'marketing_advertising', 'consulting', 'financial_services', 'banking', 'insurance',
  'accounting', 'legal', 'real_estate', 'construction', 'architecture_engineering', 'manufacturing', 'industrial_equipment',
  'automotive', 'logistics_transport', 'retail', 'ecommerce', 'consumer_goods', 'food_beverage', 'hospitality_travel',
  'healthcare', 'medical_devices', 'pharma_biotech', 'education', 'media_publishing', 'entertainment', 'telecom',
  'energy_utilities', 'agriculture', 'staffing_recruiting', 'hr_services', 'security', 'design_creative', 'events',
  'nonprofit', 'government', 'other',
] as const

export type Industry = (typeof INDUSTRIES)[number]
