export interface ComplianceNavLink {
  readonly href:
    | '/privacy-policy'
    | '/terms-of-service'
    | '/refund-policy'
    | '/license-agreement'
    | '/contact-us';
  readonly label: string;
}

export const BUSINESS_IDENTITY = {
  legalName: 'Pardeep Kumar',
  brandName: 'Exam Kart',
  platformName: 'ExamDash (ed)',
  supportEmail: 'support@exam-kart.com',
  officialWebsite: 'https://exam-dash.com/',
  officeAddress: '1st Floor, SCO-28, Sector 13, Bhiwani, Haryana 127021, India',
  supportHours: 'Monday to Saturday, 10:00 AM – 6:00 PM IST',
  responseSla: 'Within 24–48 business hours',
  jurisdiction: 'Bhiwani, Haryana, India',
  policyEffectiveDate: 'November 19, 2026',
  policyEffectiveIso: '2026-11-19T00:00:00.000Z',
} as const;

export const COMPLIANCE_PAGE_LINKS: readonly ComplianceNavLink[] = [
  { href: '/privacy-policy', label: 'Privacy Policy' },
  { href: '/terms-of-service', label: 'Terms of Service' },
  { href: '/refund-policy', label: 'Refund & Cancellation Policy' },
  { href: '/license-agreement', label: 'License Agreement' },
  { href: '/contact-us', label: 'Contact Us' },
] as const;
