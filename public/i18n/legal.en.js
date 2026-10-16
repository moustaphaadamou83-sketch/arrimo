/* Arrimo — legal pages in English. DRAFT to be reviewed by a lawyer. Fields [in brackets] are to be completed. */
window.ARRIMO_LEGAL = window.ARRIMO_LEGAL || {};
window.ARRIMO_LEGAL.en = {
  avertissement: 'Draft text to be reviewed by a lawyer. This document has no legal force yet.',
  mise_a_jour: 'Last updated: {date}',
  retour: 'Back to Arrimo',
  autre_page: { confidentialite: 'Terms of use', conditions: 'Privacy policy' },
  a_remplir: '[to be completed]',
  confidentialite: {
    titre: 'Privacy policy',
    sections: [
      ['Who we are', [
        'Arrimo is a tool for coordinating hospital beds and transfers between healthcare facilities.',
        'Responsible entity: {entite}. Address: {adresse}.',
      ]],
      ['Person in charge of the protection of personal information', [
        'Under Quebec’s Act respecting the protection of personal information in the private sector (Law 25), the person in charge is: {responsable}.',
        'For any question or request: {contact}.',
      ]],
      ['Information we collect', [
        'User accounts: name, work email address, role, linked facilities, date of last sign-in. The password is stored in encrypted form (irreversible hash); the two-factor authentication secret is stored to verify codes.',
        'Logs: every action on a bed, a transfer or an account is recorded with its date, author and outcome, including refused attempts.',
        'Pseudonymized patient references: a reference in an agreed format (e.g. P-00000), assigned by the facility, with no name, date of birth or health insurance number.',
        'No clinical data: Arrimo collects no diagnosis, result, treatment or clinical note. Bed needs (isolation, ventilation…) describe the bed’s equipment, not a health condition.',
        'Technical data: IP address and time of requests in the server logs, for security. The browser stores the session token, the chosen language and facility locally; Arrimo uses no advertising cookies or tracking tools.',
      ]],
      ['Why we use it', [
        'To let authorized teams see capacity, assign beds and organize transfers.',
        'To ensure security: authentication, two-factor authentication, detection of abnormal access.',
        'To keep a verifiable record of decisions (who did what, and when).',
        'To produce aggregate indicators measuring patient flow (delays, decline rate, cleaning time).',
      ]],
      ['Retention', [
        'Accounts: for the duration of the service, then {duree_comptes} after the account is closed.',
        'Logs: {duree_journaux}. Logs cannot be changed or deleted during this period.',
        'Sessions: 12 hours at most. Backups: 14 days.',
        'Patient references: {duree_references}.',
      ]],
      ['Security', [
        'Encrypted connection (HTTPS), encrypted passwords, two-factor authentication required for administration.',
        'Access limited by role and facility; each facility chooses what it shares with the network.',
        'Immutable logs, verified daily backups.',
        'Copilot AI mode: disabled by default. If enabled, only aggregate data, with no patient reference, is sent to the selected provider, after assessment.',
      ]],
      ['Hosting', [
        'Demonstration server: hosted outside Canada, with entirely fictitious data.',
        'Pilot project: hosting in Canada, after a privacy impact assessment. Provider: {hebergeur}.',
      ]],
      ['Disclosure to third parties', [
        'Information is neither sold nor rented. It is disclosed only to authorized facilities of the network, according to the chosen sharing level, and to providers who host or maintain the service, bound by contract.',
      ]],
      ['Your rights', [
        'You may request access to information about you, its correction or, where the law allows, its deletion.',
        'Log entries are not changed: a correction is added as a new entry.',
        'You may file a complaint with the Commission d’accès à l’information du Québec.',
        'To exercise your rights: {contact}. We answer within 30 days.',
      ]],
      ['Confidentiality incidents', [
        'Every incident is recorded in the incident register. If it presents a risk of serious injury, we notify the Commission d’accès à l’information and the people concerned.',
      ]],
      ['Changes', [
        'Any change to this policy is published on this page with its date.',
      ]],
    ],
  },
  conditions: {
    titre: 'Terms of use',
    sections: [
      ['Purpose', [
        'These terms govern the use of Arrimo by authorized people from participating facilities.',
      ]],
      ['Access', [
        'An account is personal and must not be shared. Keep your password confidential and enable two-factor authentication when asked.',
        'Report any lost device or suspicious access to your administrator without delay.',
      ]],
      ['Data entered', [
        'Never enter a patient name, diagnosis or other clinical information. Use only the agreed patient reference.',
        'On the demonstration server, use fictitious data only.',
      ]],
      ['Decisions', [
        'Arrimo, including its Copilot, proposes: the decision always belongs to an authorized person. No action is taken automatically.',
        'Arrimo does not replace clinical judgment, facility procedures or clinical information systems.',
      ]],
      ['Availability', [
        'We make reasonable efforts to keep the service available. If it is unavailable, follow the facility’s usual procedures (phone, boards).',
        'The demonstration server may be reset at any time.',
      ]],
      ['Liability', [
        'To the extent permitted by law, liability is governed by the agreement signed with each facility: {entente}.',
      ]],
      ['Intellectual property', [
        'Arrimo and its content belong to {entite}. Data entered belongs to the facilities that provide it.',
      ]],
      ['Governing law', [
        'These terms are governed by the laws of Quebec and the laws of Canada applicable therein.',
      ]],
      ['Contact', [
        '{contact}',
      ]],
    ],
  },
};
