import { SITE } from '@/shared/utilities/site'

/**
 * The words of the Terms, the Privacy notice and the Contact page, as data so a test can check that the required parts are there and the page can show a contents list.
 * They describe what DOA does today (see docs/apps.md and docs/school.md for what is and is not built) and make no promise the product cannot keep.
 * They are written in plain language as a starting point and should be read by a Nigerian lawyer before DOA is offered widely.
 */
export interface LegalSection { id: string; title: string; paragraphs?: string[]; bullets?: string[] }

const { company: C, supportEmail: E } = SITE

export const TERMS: LegalSection[] = [
  { id: 'who', title: 'Who we are and what this is', paragraphs: [
    `${C} ("we", "us") provides DOA, a set of business apps (CRM, point of sale, inventory, invoices, expenses, finance, calendar) and industry apps (shop, farm, bakery, pharmacy, school) that you use in your web browser. These terms are the agreement between us and the person or organisation that creates a workspace ("you").`,
    'By creating an account or using DOA you agree to these terms and to our Privacy notice. If you use DOA for an organisation, you confirm that you may agree on its behalf.',
    'DOA is new and is being introduced business by business and school by school. Features and screens will change, and we will tell you about changes that affect how you use it.',
  ] },
  { id: 'accounts', title: 'Accounts and who is responsible for what', bullets: [
    'You must give a real name and an email address you can read, and keep your password private. What is done with your account is your responsibility.',
    'The person who creates a business is its owner and can invite others and give them roles. The owner is responsible for who is given access and for removing people who should no longer have it.',
    'Each business is separate: other businesses cannot see your records, and you cannot see theirs.',
    'Tell us at once if you think someone else has got into your account.',
  ] },
  { id: 'your-data', title: 'Your data belongs to you', paragraphs: [
    'The records you and your team enter (customers, sales, stock, invoices, students, results, fees and so on) are yours. We hold them to run DOA for you, and we do not sell them or use them for advertising.',
    'You give us permission to store and process your records only as needed to provide DOA, keep it secure and fix problems. You can ask us for a copy of your records, or for them to be deleted, at any time (see Privacy and Contact).',
  ] },
  { id: 'schools', title: 'Schools, students and parents', paragraphs: [
    'A school that uses DOA decides what student, parent and staff information to put in it and why. The school is responsible for having the right to hold that information, for telling parents and guardians how it is used, and for getting any consent the law requires, including for photographs. We process that information on the school\'s behalf and on its instructions.',
    'The school decides who on its staff can see what. Parents and guardians who are given a login can see only the records linked to their own children.',
  ] },
  { id: 'use', title: 'Using DOA properly', bullets: [
    'Do not use DOA to break the law, to harm or deceive others, or to store content you have no right to hold.',
    'Do not try to get into another business\'s data, to test or probe our security without our written permission, or to overload the service.',
    'Do not copy, resell or build a competing service from DOA, or remove notices from it.',
    'We may suspend an account that breaks these rules or puts others at risk, and we will tell you why when we can.',
  ] },
  { id: 'money', title: 'Plans, prices and payment', paragraphs: [
    'Some plans are free. The prices of paid plans are on the pricing page and may change, but a change does not affect a period you have already paid for. Taxes, if any, are extra.',
    'Online card payment for plans is not available yet. Paid plans are arranged and invoiced with us directly. If a paid plan lapses, your records stay readable and you can still get a copy of them, but you cannot add new records to the paid apps until it is paid.',
  ] },
  { id: 'not-advice', title: 'DOA is a tool, not professional advice', paragraphs: [
    'DOA helps you keep records and see figures. Its reports are worked out from what you enter. The finance screens are on a cash basis: they show money that moved, not profit, and DOA is not an accounting package or tax advice. Check anything important, such as tax returns, results or fee demands, before you rely on it.',
    'For pharmacies: DOA records stock and sales and helps with prescriptions and expiry, but it does not replace a pharmacist\'s professional judgement or your legal duties.',
  ] },
  { id: 'service', title: 'Availability and our responsibility', paragraphs: [
    'We work to keep DOA running and your records safe, but we cannot promise it will never be interrupted or free of mistakes. DOA is provided as it is, to the extent the law allows.',
    'To the extent the law allows, we are not liable for indirect or lost profit, or for loss caused by something outside our control (such as a power or network failure or a fault at our hosting provider). Where the law makes us liable, our total liability for a claim is limited to the amount you paid us in the 12 months before it. Nothing here limits a liability that the law does not allow to be limited.',
  ] },
  { id: 'ending', title: 'Ending the agreement', paragraphs: [
    'You can stop using DOA at any time. Ask us for a copy of your records first if you want one. If you ask us to delete a business, we will do so and tell you when it is done, except for what we must keep for the law or for security (for example a record that a deletion happened).',
    'We may end the agreement if you break these terms, or if we stop offering DOA, in which case we will give you notice and time to take a copy of your records.',
  ] },
  { id: 'law', title: 'Changes, law and contact', paragraphs: [
    'We may change these terms. If a change matters, we will tell you before it applies, for example by email or a notice in DOA. If you keep using DOA after that, you accept the change.',
    `These terms are governed by the laws of the Federal Republic of ${SITE.country}. Questions about them: ${E}.`,
  ] },
]

export const PRIVACY: LegalSection[] = [
  { id: 'summary', title: 'In short', bullets: [
    'We keep the account details you give us and the business records you and your team enter, so DOA can work for you.',
    'We do not sell your data and we do not use it for advertising. DOA has no advertising or tracking cookies.',
    'Each business\'s records are separate from every other business\'s, and people see only what their role allows.',
    `You can ask us to show, correct, copy or delete your information at any time: ${E}.`,
  ] },
  { id: 'who', title: 'Who is responsible for the information', paragraphs: [
    `${C} runs DOA. For your account details we decide how they are used, and so we are responsible for them (the "controller").`,
    'For the records a business or school enters about its own customers, students, parents, staff and suppliers, the business or school decides what to enter and why, and is responsible for it. We process those records for them, and only on their instructions.',
  ] },
  { id: 'what', title: 'What information we hold', bullets: [
    'Account: your name, email address and a password (stored in a protected form that we cannot read), and your profile picture if you add one.',
    'Business: the business name, type, settings, who works there and their roles, and the plan.',
    'Records you enter: for example customers, leads, products and stock, sales, invoices and payments, expenses, calendar events, and for schools students, parents or guardians, staff, attendance, results, fees, documents and photographs.',
    'Use of the service: a log of important changes (who changed what and when) so a business can see what happened, and technical records needed to keep the service secure and working.',
    'We do not ask for information we do not need, and we do not collect card numbers: online card payment is not part of DOA yet.',
  ] },
  { id: 'children', title: 'Children\'s information', paragraphs: [
    'Schools may record information about children: names, dates of birth, classes, attendance, results, fees, contact details they choose to enter, documents and photographs. We treat this as sensitive.',
    'The school is responsible for having the right to hold it and for telling parents and guardians how it is used. We use it only to run DOA for that school. We never use it for advertising or sell it. Parents and guardians who have a login can see only their own children\'s records.',
    `A parent or guardian who has a question or wants to see, correct or delete a child's record should ask the school first. They can also write to us at ${E}, and we will pass the request to the school or help the school deal with it.`,
  ] },
  { id: 'why', title: 'Why we use it', bullets: [
    'To provide DOA: to sign you in, keep each business\'s records, work out totals, and let people with the right role do their work.',
    'To keep it safe and fix problems: to prevent misuse, investigate faults and keep an audit trail.',
    'To send you the emails DOA needs to work: confirming your address, resetting a password, and invitations. We do not send marketing email without asking you first.',
    'To meet the law, and to protect our rights when we have to.',
  ] },
  { id: 'who-sees', title: 'Who can see it', bullets: [
    'Inside a business: only people the owner has invited, and only what their role allows (for example a cashier cannot see a school\'s results).',
    'Us: a small number of our own staff can see technical and account information to run and support the service. We look at a business\'s records only when needed to fix a problem or when you ask us to, and what we do is logged.',
    'Our service providers, who help us run DOA and may only use the information for that: our database and sign-in provider (Supabase, with its servers in Ireland), our web hosting provider (Vercel), and Google, whose mail service sends our emails.',
    'Nobody else, unless the law requires us to give information to a public authority.',
  ] },
  { id: 'abroad', title: 'Where it is kept', paragraphs: [
    'Our database is hosted in Europe (Ireland), and our website is delivered through a global network. This means your information is processed outside Nigeria. We use providers that protect it with security measures, and we only share what is needed for them to do their job.',
  ] },
  { id: 'security', title: 'How we protect it', bullets: [
    'Connections to DOA are encrypted (HTTPS).',
    'Passwords are stored in a protected form. Sign-in is checked by the database, and the rules about who may see what are enforced in the database itself, not only on the screen.',
    'Each business\'s records are separated from every other business\'s, and we test that regularly.',
    'Important changes are written to an audit log that cannot be edited.',
    'No system is perfectly secure. If a breach affects your information, we will tell you and the authorities as the law requires.',
  ] },
  { id: 'keep', title: 'How long we keep it', paragraphs: [
    'We keep your information while your account or business is active. When you ask us to delete a business or your account, we delete the information, except what we must keep for the law or security. Backups that hold deleted information are replaced on a regular cycle, so it can remain in them for a short time before it is gone.',
  ] },
  { id: 'rights', title: 'Your rights', paragraphs: [
    'Under the Nigeria Data Protection Act 2023 you have the right to know what we hold about you, to see it and get a copy, to have mistakes corrected, to have it deleted when we no longer need it, to object to or restrict how it is used, and to complain.',
    `Write to ${E} and say which business or school it concerns. We will confirm who you are first, and we aim to answer within one month. You can also complain to the Nigeria Data Protection Commission.`,
  ] },
  { id: 'cookies', title: 'Cookies and similar storage', paragraphs: [
    'DOA uses only the browser storage it needs to keep you signed in and to remember your choices (for example which business you opened and how you like lists shown). It does not use advertising or tracking cookies, and it does not share your activity with advertisers.',
  ] },
  { id: 'changes', title: 'Changes and contact', paragraphs: [
    `We may update this notice. The date at the top shows when it last changed, and we will tell you about changes that matter. Questions: ${E}.`,
  ] },
]

export const CONTACT_TOPICS: { title: string; body: string; subject: string }[] = [
  { title: 'I need help using DOA', body: 'Tell us which app or screen you were on, what you expected, and what happened instead. A screenshot helps.', subject: 'Help with DOA' },
  { title: 'My school or business wants to start', body: 'Tell us what kind of business it is, how many people will use it, and whether you have records to bring in (a spreadsheet of students or products, for example).', subject: 'Starting with DOA' },
  { title: 'I want a copy of my records, or them deleted', body: 'Write from the email address on your account, and say which business or school it is. We will confirm who you are before we send or delete anything.', subject: 'My records' },
  { title: 'A question about a child\'s record', body: 'Please ask the school first, because the school decides what is held. If you still need help, write to us with the school\'s name and we will pass it on.', subject: 'Question about a student record' },
  { title: 'I found a security problem', body: 'Thank you for telling us. Describe what you found and how to see it, and please do not share it publicly until we have fixed it. Do not access other people\'s data to prove a point.', subject: 'Security report' },
]
