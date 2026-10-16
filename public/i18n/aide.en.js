/* Arrimo — built-in help in English: role, screens, first steps. Same keys as aide.fr.js. */
window.ARRIMO_I18N = window.ARRIMO_I18N || {};
window.ARRIMO_I18N.en = window.ARRIMO_I18N.en || {};
window.ARRIMO_I18N.en.aide = {
  titre: 'Help', bouton: 'Help', fermer: 'Close', votre_role: 'Your role', cet_ecran: 'This screen: {ecran}', a_quoi: 'What it is for',
  gestes: 'Main actions', erreurs: 'Common messages and what to do', autres: 'Other screens', revoir: 'See the first steps again',
  contact: 'A question? Contact your facility’s bed coordination team or the network manager.',
  roles: {
    coordonnateur: {
      titre: 'Bed coordination and emergency',
      texte: 'You follow your facility’s capacity, assign beds to waiting patients and organize transfers. '
        + 'In the ER, you add patients to the admission queue (Admissions tab) and follow the assignment of their bed.',
    },
    entretien: {
      titre: 'Housekeeping',
      texte: 'You only see the Cleaning screen: the list of beds to clean in the recommended order. Start at the top of the list (beds and ER stretchers), '
        + 'press “Start” when you enter the room, then “Done”.',
    },
    admin_etab: {
      titre: 'Facility administration',
      texte: 'In addition to the coordination screens, you manage accounts, units, rooms, beds and connectors for your facilities. '
        + 'Two-factor authentication is required to enter Administration.',
    },
    gestionnaire: {
      titre: 'Network manager',
      texte: 'You see the whole network. You manage the country configuration (thresholds, radius, protocols), facility activation, '
        + 'accounts and network connectors. Two-factor authentication is required to enter Administration.',
    },
  },
  ecrans: {
    copilote: {
      nom: 'Copilot',
      but: 'The situation summary for the bed management meeting: alert level, ranked recommendations and answers to your questions. The Copilot proposes; you decide.',
      gestes: [
        'Read the level banner: pressure counts the patients waiting for a bed.',
        'Handle “Urgent” recommendations first; each one explains why.',
        'Click a recommendation’s button to apply it: nothing happens without your click.',
        'Ask a question or pick an example (“What should we do first?”).',
      ],
      erreurs: [
        ['“Bed … was just changed by someone else”', 'A colleague acted before you. The page refreshes: pick the next recommendation.'],
        ['“The Copilot is available once the module is enabled”', 'Your facility is not enabled yet. Contact the network manager.'],
      ],
    },
    reseau: {
      nom: 'Network',
      but: 'Capacity of nearby facilities and the search for a bed elsewhere, from closest to farthest, avoiding overflowing hospitals.',
      gestes: [
        'Choose the unit type, enter the patient reference and tick the needs (isolation, ventilation…).',
        'Click “Search”: the recommended facility comes first, with the reason.',
        'Click “Propose”, check the summary, then “Confirm and reserve”.',
        'Watch “Detected blockages”: beds that are not turning over when they should.',
      ],
      erreurs: [
        ['“Invalid patient reference”', 'Use the format shown (e.g. P-00000). Never enter a name or diagnosis.'],
        ['“No free bed left at …”', 'The last bed was just taken. Search again.'],
      ],
    },
    national: {
      nom: 'National',
      but: 'Every facility that shares its capacity, from nearest to farthest, with no distance limit: free and expected beds by unit type, stretchers, alert level.',
      gestes: [
        'Choose the unit type and the patient’s needs, then check “With a free bed only”.',
        'Limit the drive time if needed (30 min, 1 h, 2 h, 4 h).',
        'Open the map to see each facility’s alert level.',
        'Click “Transfer here”, enter the patient reference and confirm: the bed is held and the receiving facility is notified.',
      ],
      erreurs: [
        ['“No free bed left at …”', 'The last bed was just taken. Choose the next facility in the list.'],
        ['“This facility does not share its capacity”', 'It does not appear on the national dashboard; call it directly.'],
      ],
    },
    lits: {
      nom: 'Beds',
      but: 'All the facility’s beds by state: free, reserved, occupied, cleaning, unavailable. Every change is logged.',
      gestes: [
        'Filter by unit with the chips at the top.',
        'Reserve a free bed with the patient reference, then “Admit” on arrival.',
        'When the patient leaves, “Release”: the bed goes to cleaning.',
        'Record a planned discharge or designate an ALC patient from an occupied bed.',
        'Take a bed out of service with its reason (staff shortage, equipment…).',
      ],
      erreurs: [
        ['“Transition not allowed”', 'The cycle is fixed: free → reserved → occupied → cleaning → free. Follow the order.'],
        ['“This bed is linked to transfer … in progress”', 'Decline the transfer in the Transfers tab to free the bed.'],
      ],
    },
    urgence: {
      nom: 'ER',
      but: 'The ER stretchers: who is on a stretcher, for how long, in the hallway or not, and who is still waiting for a bed. The occupancy rate can exceed 100%.',
      gestes: [
        'Free: “Place a patient” with their reference (e.g. P-00000).',
        'Occupied: “Request a bed” adds the patient to the admission queue, linked to their stretcher.',
        'When a regular stretcher frees up, “Change stretcher” moves a patient out of the hallway.',
        'When the patient is admitted to a bed, the stretcher goes to cleaning on its own; “Cleaning done” makes it free.',
        'Watch times in orange (over 24 h) and red (over 48 h).',
      ],
      erreurs: [
        ['“… has a bed request in progress”', 'The patient is waiting for a bed: admit them from Admissions, or cancel their request before they leave.'],
        ['“Patient … is already on stretcher …”', 'A patient is on one stretcher at a time. Use “Change stretcher”.'],
      ],
    },
    admissions: {
      nom: 'Admissions',
      but: 'The queue of patients waiting for a bed, often on a stretcher in the ER, with the best free bed matching their needs.',
      gestes: [
        'Add a request: unit type, patient reference, priority, origin and needs.',
        'Click “Assign” to reserve the proposed bed.',
        'With no suitable bed here, “Find elsewhere” proposes the closest facility that has one.',
        'When the patient arrives in the unit, click “Admit”.',
      ],
      erreurs: [
        ['“This request is no longer waiting”', 'A colleague already handled it. The queue refreshes.'],
        ['“This bed does not match … the patient’s needs”', 'Choose a bed with the required equipment, or look elsewhere.'],
      ],
    },
    transferts: {
      nom: 'Transfers',
      but: 'Incoming and outgoing transfers, step by step. Each step belongs to the facility concerned.',
      gestes: [
        'Receiving facility: “Room ready” once the room is prepared; the requester is notified. No record to create: the reference, needs and arrival time are enough.',
        'Receiving facility: “Accept” or “Decline” a request (the bed is already held for the patient).',
        'Requesting facility: “Arrange transport”, then “Confirm departure”.',
        'Receiving facility: “Confirm arrival”; the bed becomes occupied.',
      ],
      erreurs: [
        ['“This action belongs to …”', 'The other facility must act. The card shows who is expected.'],
        ['“Transfer … is no longer at the expected status”', 'Someone already did this step. The page refreshes.'],
      ],
    },
    nettoyage: {
      nom: 'Cleaning',
      but: 'Beds to clean, in the recommended order: units where patients are waiting for a bed come first.',
      gestes: [
        'Take the bed at the top of the list.',
        'Press “Start” when you enter the room.',
        'Press “Done” when the room is ready: the bed becomes free everywhere.',
      ],
      erreurs: [
        ['“This bed is not waiting for cleaning”', 'Cleaning was already started or confirmed by a colleague.'],
        ['“Your role gives access to the Cleaning screen only”', 'This is normal: the other screens are for coordination.'],
      ],
    },
    nsa: {
      nom: 'ALC',
      but: 'Patients who no longer need acute care and are waiting for another resource (long-term care, intermediate resource…), compared with the target.',
      gestes: [
        'Follow the ALC rate against the target.',
        'Update each patient’s expected destination.',
        'Remove the ALC status when the patient needs acute care again.',
      ],
      erreurs: [
        ['“Bed … is not occupied”', 'ALC status only applies to an occupied bed.'],
      ],
    },
    indicateurs: {
      nom: 'Indicators',
      but: 'Figures to track progress and support reporting: occupancy, wait before bed, transfer times, declines, cleaning.',
      gestes: [
        'Choose the period (7, 30 or 90 days).',
        'Compare cleaning time with the target.',
        'Export as CSV for your reports.',
      ],
      erreurs: [
        ['“Export failed”', 'Your session may have expired. Sign in again and retry.'],
      ],
    },
    journal: {
      nom: 'Log',
      but: 'Who changed what, and when, including refused attempts. The log cannot be changed or deleted.',
      gestes: [
        'Find an action by its bed or transfer number.',
        'Refused actions appear in red, with their reason.',
      ],
      erreurs: [],
    },
    params: {
      nom: 'Settings',
      but: 'The configuration in force (radius, forecast horizon, targets) and facility activation.',
      gestes: [
        'Check the values used by Arrimo.',
        'Network manager: enable a facility or change its sharing level.',
      ],
      erreurs: [
        ['“Reserved for the network manager”', 'Only the network manager changes activation and sharing.'],
      ],
    },
    admin: {
      nom: 'Administration',
      but: 'Accounts, units, rooms and beds, country configuration, connectors and the administration log.',
      gestes: [
        'First enable two-factor authentication in My account.',
        'Create an account: a temporary password is shown only once; share it through a secure channel.',
        'Reset the password of someone who forgot it.',
        'Add units, rooms and beds, and tick their equipment.',
        'Create a connector for the hospital system; the key is shown only once.',
      ],
      erreurs: [
        ['“Enable two-factor authentication”', 'Go to My account, scan the QR code, enter the 6-digit code.'],
        ['“An account already exists with this address”', 'Find the person in the list; re-enable or reset their account.'],
      ],
    },
    compte: {
      nom: 'My account',
      but: 'Your password, two-factor authentication and the interface language.',
      gestes: [
        'Change your password: at least 12 characters, with letters and numbers.',
        'Enable two-factor authentication with an app (Microsoft Authenticator, Google Authenticator…).',
        'Choose the interface language.',
      ],
      erreurs: [
        ['“Incorrect code. Check the time on your phone”', 'Your phone’s time must be set automatically. Try again with the next code.'],
        ['“Current password is incorrect”', 'Check what you typed. If you forgot it, ask your administrator for a reset.'],
      ],
    },
  },
  premiers_pas: {
    titre: 'First steps in Arrimo',
    intro: 'Arrimo helps find the right bed, in the right place, faster. Here is what you need to get started.',
    commun: [
      'No medical data: only a patient reference (e.g. P-00000). Never a name or diagnosis.',
      'Every action is logged. A bed can only be taken once.',
      'The “Help” button at the top explains the screen you are on.',
    ],
    roles: {
      coordonnateur: ['Start with the Copilot tab: alert level and recommendations.', 'In the ER, the ER tab shows the stretchers; “Request a bed” adds the patient to the admission queue.'],
      entretien: ['Your screen is Cleaning: take the bed at the top of the list.', 'Press “Start”, then “Done”.'],
      admin_etab: ['Enable two-factor authentication in My account before entering Administration.', 'Create your team’s accounts and check your units and beds.'],
      gestionnaire: ['Enable two-factor authentication in My account before entering Administration.', 'The Copilot shows each hospital’s level and possible offloading.'],
    },
    ok: 'Got it',
  },
};
