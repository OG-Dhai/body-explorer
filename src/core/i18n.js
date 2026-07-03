import eventBus from './eventBus.js';

const DICTIONARY = {
  en: {
    // Target Names
    'target.nose': 'Nose',
    'target.left_shoulder': 'Left Shoulder',
    'target.right_shoulder': 'Right Shoulder',
    'target.left_elbow': 'Left Elbow',
    'target.right_elbow': 'Right Elbow',
    'target.head': 'Head',
    'target.stomach': 'Stomach',
    'target.left_knee': 'Left Knee',
    'target.right_knee': 'Right Knee',
    'target.left_ankle': 'Left Ankle',
    'target.right_ankle': 'Right Ankle',
    'target.left_ear': 'Left Ear',
    'target.right_ear': 'Right Ear',
    
    // HUD Instructions (Direct)
    'inst.nose': '👆 Touch your NOSE!',
    'inst.left_shoulder': '👆 Touch your LEFT SHOULDER!',
    'inst.right_shoulder': '👆 Touch your RIGHT SHOULDER!',
    'inst.left_elbow': '👆 Touch your LEFT ELBOW!',
    'inst.right_elbow': '👆 Touch your RIGHT ELBOW!',
    'inst.head': '👆 Touch your HEAD!',
    'inst.stomach': '👆 Touch your STOMACH!',
    'inst.left_knee': '👆 Touch your LEFT KNEE!',
    'inst.right_knee': '👆 Touch your RIGHT KNEE!',
    'inst.left_ankle': '👆 Touch your LEFT ANKLE!',
    'inst.right_ankle': '👆 Touch your RIGHT ANKLE!',
    'inst.left_ear': '👆 Touch your LEFT EAR!',
    'inst.right_ear': '👆 Touch your RIGHT EAR!',

    // TTS Educational Questions
    'edu.nose': 'Where is your nose? Point to it!',
    'edu.left_shoulder': 'Which joint connects your left arm to your body?',
    'edu.right_shoulder': 'Which joint connects your right arm to your body?',
    'edu.left_elbow': 'Which joint helps you bend your left arm?',
    'edu.right_elbow': 'Which joint helps you bend your right arm?',
    'edu.head': 'Where is your head? Can you touch it?',
    'edu.stomach': 'Where does your food go? Point to your stomach!',
    'edu.left_knee': 'Which joint helps you bend your left leg?',
    'edu.right_knee': 'Which joint helps you bend your right leg?',
    'edu.left_ankle': 'Which joint connects your left foot to your leg?',
    'edu.right_ankle': 'Which joint connects your right foot to your leg?',
    'edu.left_ear': 'What do you use to hear on your left side?',
    'edu.right_ear': 'What do you use to hear on your right side?',
    
    // UI Elements
    'ui.start_game': 'Start Game',
    'ui.score': 'Score',
    'ui.play_again': 'PLAY AGAIN',
    'ui.final_score': 'Final Score',
    'ui.avg_time': 'Avg Time',
    'ui.best_streak': 'Best Streak',
    'ui.victory_title': 'YAY! YOU DID IT!',
    'ui.victory_subtitle': 'Great job exploring your body!',
    'ui.question_of': 'Question {0} of {1}',
    'ui.streak': 'Streak: {0}',
    
    // Feedback
    'fb.lightning': 'Lightning Fast! ⚡',
    'fb.great': 'Great Job! 🎯',
    'fb.nice': 'Nice! 👍',
    
    // Voice Preset for Kokoro
    'tts.voice': 'af_sky'
  },
  de: {
    // Target Names
    'target.nose': 'Nase',
    'target.left_shoulder': 'Linke Schulter',
    'target.right_shoulder': 'Rechte Schulter',
    'target.left_elbow': 'Linker Ellbogen',
    'target.right_elbow': 'Rechter Ellbogen',
    'target.head': 'Kopf',
    'target.stomach': 'Bauch',
    'target.left_knee': 'Linkes Knie',
    'target.right_knee': 'Rechtes Knie',
    'target.left_ankle': 'Linker Knöchel',
    'target.right_ankle': 'Rechter Knöchel',
    'target.left_ear': 'Linkes Ohr',
    'target.right_ear': 'Rechtes Ohr',
    
    // HUD Instructions (Direct)
    'inst.nose': '👆 Berühre deine NASE!',
    'inst.left_shoulder': '👆 Berühre deine LINKE SCHULTER!',
    'inst.right_shoulder': '👆 Berühre deine RECHTE SCHULTER!',
    'inst.left_elbow': '👆 Berühre deinen LINKEN ELLBOGEN!',
    'inst.right_elbow': '👆 Berühre deinen RECHTEN ELLBOGEN!',
    'inst.head': '👆 Berühre deinen KOPF!',
    'inst.stomach': '👆 Berühre deinen BAUCH!',
    'inst.left_knee': '👆 Berühre dein LINKES KNIE!',
    'inst.right_knee': '👆 Berühre dein RECHTES KNIE!',
    'inst.left_ankle': '👆 Berühre deinen LINKEN KNÖCHEL!',
    'inst.right_ankle': '👆 Berühre deinen RECHTEN KNÖCHEL!',
    'inst.left_ear': '👆 Berühre dein LINKES OHR!',
    'inst.right_ear': '👆 Berühre dein RECHTES OHR!',

    // TTS Educational Questions
    'edu.nose': 'Wo ist deine Nase? Zeig sie mir!',
    'edu.left_shoulder': 'Welches Gelenk verbindet deinen linken Arm mit dem Körper?',
    'edu.right_shoulder': 'Welches Gelenk verbindet deinen rechten Arm mit dem Körper?',
    'edu.left_elbow': 'Mit welchem Gelenk kannst du deinen linken Arm beugen?',
    'edu.right_elbow': 'Mit welchem Gelenk kannst du deinen rechten Arm beugen?',
    'edu.head': 'Wo ist dein Kopf? Kannst du ihn berühren?',
    'edu.stomach': 'Wo landet dein Essen? Zeig auf deinen Bauch!',
    'edu.left_knee': 'Mit welchem Gelenk kannst du dein linkes Bein beugen?',
    'edu.right_knee': 'Mit welchem Gelenk kannst du dein rechtes Bein beugen?',
    'edu.left_ankle': 'Welches Gelenk verbindet deinen linken Fuß mit dem Bein?',
    'edu.right_ankle': 'Welches Gelenk verbindet deinen rechten Fuß mit dem Bein?',
    'edu.left_ear': 'Womit hörst du auf deiner linken Seite?',
    'edu.right_ear': 'Womit hörst du auf deiner rechten Seite?',

    // UI Elements
    'ui.start_game': 'Spiel Starten',
    'ui.score': 'Punkte',
    'ui.play_again': 'NOCHMAL SPIELEN',
    'ui.final_score': 'Endergebnis',
    'ui.avg_time': 'Ø Zeit',
    'ui.best_streak': 'Beste Serie',
    'ui.victory_title': 'SUPER GEMACHT!',
    'ui.victory_subtitle': 'Toll, dass du deinen Körper erkundet hast!',
    'ui.question_of': 'Frage {0} von {1}',
    'ui.streak': 'Serie: {0}',
    
    // Feedback
    'fb.lightning': 'Blitzschnell! ⚡',
    'fb.great': 'Tolle Leistung! 🎯',
    'fb.nice': 'Schön! 👍',
    
    // Voice Preset for Kokoro
    'tts.voice': 'bf_emma' // Using British/Emma or similar for German alternative if needed. 
    // Ideally Kokoro has a German voice but we'll fall back to English-sounding voice trying to speak German text if not supported.
  }
};

let currentLocale = 'en';

export const i18n = {
  t(key, ...args) {
    const dict = DICTIONARY[currentLocale];
    let str = dict[key] || key;
    args.forEach((arg, i) => {
      str = str.replace(`{${i}}`, arg);
    });
    return str;
  },
  
  setLocale(lang) {
    if (DICTIONARY[lang]) {
      currentLocale = lang;
      eventBus.emit('i18n:change', { lang });
    }
  },
  
  getLocale() {
    return currentLocale;
  }
};
