export interface Credit {
  role: string;
  name: string;
}

export interface Film {
  id: string;
  title: string;
  /** Short line under the title. */
  tagline: string;
  year: number;
  genre: string;
  runtime: string;
  license: string;
  project: string;
  synopsis: string;
  credits: Credit[];
  facts: string[];
  /** Mux playback ID. */
  playbackId: string;
  src: string;
  poster: string;
  /** Small Mux thumbnail for the dial. */
  thumb: string;
  /** Hue used to tint the page backdrop while this film is in focus. */
  tint: string;
}

/** Stream and image URLs for a Mux playback ID (https://www.mux.com/docs). */
const mux = (playbackId: string) => ({
  playbackId,
  src: `https://stream.mux.com/${playbackId}.m3u8`,
  poster: `https://image.mux.com/${playbackId}/thumbnail.webp?width=1280`,
  thumb: `https://image.mux.com/${playbackId}/thumbnail.webp?width=160&height=160&fit_mode=smartcrop`,
});

/**
 * Four films from the Blender Foundation's open movie projects, all released
 * under Creative Commons Attribution and streamed from Mux.
 */
export const films: Film[] = [
  {
    id: 'sintel',
    title: 'Sintel',
    tagline: 'A lone hunter searches the frozen north for the dragon she raised.',
    year: 2010,
    genre: 'Fantasy',
    runtime: '14 min',
    license: 'CC BY 3.0',
    project: 'Project Durian',
    synopsis:
      'Sintel finds a wounded baby dragon, names him Scales and nurses him back to health. When an adult dragon carries him off, she sets out across mountains and marshland to bring him home, and learns what the years of searching have cost her.',
    credits: [
      { role: 'Director', name: 'Colin Levy' },
      { role: 'Producer', name: 'Ton Roosendaal' },
      { role: 'Music', name: 'Jan Morgenstern' },
      { role: 'Sintel', name: 'Halina Reijn' },
    ],
    facts: [
      'Third open movie from the Blender Institute in Amsterdam.',
      'Production pushed Blender 2.5 forward, including its new sculpting tools.',
    ],
    ...mux('31iOy9KXbfCKMwObqF6pWRnFzzCWQ4CquJTuGn02rJFo'),
    tint: '24 30% 9%',
  },
  {
    id: 'tears-of-steel',
    title: 'Tears of Steel',
    tagline: 'Scientists in a ruined Amsterdam try to undo the end of the world.',
    year: 2012,
    genre: 'Science fiction',
    runtime: '12 min',
    license: 'CC BY 3.0',
    project: 'Project Mango',
    synopsis:
      'A group of warriors and scientists gathers at the Oude Kerk to stage a desperate experiment: recreate a single moment from the past, a break-up between two lovers, in the hope that it will stop the robots overrunning the city.',
    credits: [
      { role: 'Director', name: 'Ian Hubert' },
      { role: 'Producer', name: 'Ton Roosendaal' },
      { role: 'Music', name: 'Joram Letwory' },
      { role: 'Cast', name: 'Derek de Lint, Sergio Hasselbaink' },
    ],
    facts: [
      'The first Blender open movie shot with live actors.',
      'Built to develop and test Blender’s camera tracking and compositing.',
    ],
    ...mux('TjHvp7heA4GNlk9nQ0202yFE0052XKl5y015HANsmTWwn600'),
    tint: '205 25% 9%',
  },
  {
    id: 'big-buck-bunny',
    title: 'Big Buck Bunny',
    tagline: 'A gentle giant of a rabbit gets even with three forest bullies.',
    year: 2008,
    genre: 'Comedy',
    runtime: '10 min',
    license: 'CC BY 3.0',
    project: 'Project Peach',
    synopsis:
      'Big Buck Bunny wakes up to a perfect spring morning, until Frank, Rinky and Gimera start picking on the smaller animals of the meadow. Pushed one step too far, the easy-going rabbit plans a series of elaborate and very physical lessons.',
    credits: [
      { role: 'Director', name: 'Sacha Goedegebure' },
      { role: 'Producer', name: 'Ton Roosendaal' },
      { role: 'Music', name: 'Jan Morgenstern' },
      { role: 'Studio', name: 'Blender Institute' },
    ],
    facts: [
      'One of the most used test clips on the web.',
      'Its fur and grass shots drove major work on Blender’s hair rendering.',
    ],
    ...mux('duBClVrzbiqDEv00X6UWW3cGy02vF9C02vwPHstZ6dV9v00'),
    tint: '95 22% 9%',
  },
  {
    id: 'elephants-dream',
    title: 'Elephants Dream',
    tagline: 'Two men wander a machine that may only exist in one of their heads.',
    year: 2006,
    genre: 'Surreal',
    runtime: '11 min',
    license: 'CC BY 2.5',
    project: 'Project Orange',
    synopsis:
      'Old Proog guides the young Emo through the Machine, an endless world of wires, switches and hollow rooms. Proog insists it is full of wonders. Emo sees only traps, and the further they go the less the two of them agree on what is real.',
    credits: [
      { role: 'Director', name: 'Bassam Kurdali' },
      { role: 'Producer', name: 'Ton Roosendaal' },
      { role: 'Proog', name: 'Tygo Gernandt' },
      { role: 'Emo', name: 'Cas Jansen' },
    ],
    facts: [
      'The first open movie: every source file was published with the film.',
      'Made almost entirely with open-source software.',
    ],
    ...mux('s6aWm001zQwJIq91cOjnDCo8fMQeHVSRteD5ylWk5RcQ'),
    tint: '275 14% 9%',
  },
];

/** Plays when a primary source fails to load. */
export const FALLBACK_SRC =
  'https://stream.mux.com/BV3YZtogl89mg9VcNBhhnHm02Y34zI1nlMuMQfAbl3dM.m3u8';
