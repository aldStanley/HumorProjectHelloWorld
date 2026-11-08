// The curated meme-template library for "Find Meme for Columbia Context".
// Each entry is a meme image plus its hand-tuned recognize-content verdict —
// the same pinned JSONs used in scripts/meme-opt/pins/ (keep in sync when the
// lab produces a better version; this file is the deployed copy).
export type MemeTemplate = {
  id: string
  name: string
  url: string
  recognize: Record<string, unknown>
}

export const MEME_TEMPLATES: MemeTemplate[] = [
  {
    id: '4412749e-be7e-4e37-9839-ee41b695b788',
    name: 'Henry Danger laptop reaction',
    url: 'https://images.almostcrackd.ai/2877cb7c-4ef9-4fcc-921c-8ca87d6ed47f/4412749e-be7e-4e37-9839-ee41b695b788.jpeg',
    recognize: {
      template_name: 'Henry Danger laptop reaction',
      meaning:
        'Used as a reaction image to seeing something shocking, ridiculous, cursed, or unexpected on a computer or phone screen.',
      how_a_caption_should_use_it:
        'The caption should set up that someone is reading or discovering surprising content. The image supplies the reaction.',
      image_is_punchline: true,
      image_delivers: 'a shocked, confused, or horrified reaction to something seen on a screen',
      is_meme: true,
      confidence: 0.93,
    },
  },
  {
    id: '5f3499de-17f3-410d-b6d5-539fdcf58a71',
    name: 'Bugs Bunny NO reaction',
    url: 'https://images.almostcrackd.ai/2877cb7c-4ef9-4fcc-921c-8ca87d6ed47f/5f3499de-17f3-410d-b6d5-539fdcf58a71.jpeg',
    recognize: {
      content: [
        {
          name: 'Bugs Bunny',
          type: 'cartoon_character',
          confidence: 100,
          description:
            "Bugs Bunny, a classic character from the Looney Tunes animated series, shown here with an unimpressed expression and the word 'NO' in bold letters.",
        },
      ],
      scene_context:
        "This image is a popular reaction meme featuring Bugs Bunny from Looney Tunes, used to emphatically reject or dismiss something with a simple 'NO.'",
      meme: {
        is_meme: true,
        template_name: 'Bugs Bunny NO reaction',
        meaning:
          'Used as a reaction image to bluntly and humorously reject a suggestion, request, or statement.',
        how_a_caption_should_use_it:
          "Caption should set up a scenario or request that is being rejected; the image delivers the emphatic 'NO.'",
        image_is_punchline: true,
        image_delivers: 'an emphatic NO',
        confidence: 1.0,
      },
    },
  },
  {
    id: '50189558-2437-48c3-acc5-f9e4a7950b12',
    name: 'Smiling Cat / Awkward Cat reaction',
    url: 'https://images.almostcrackd.ai/3caa0904-5aa6-4e7a-ad80-6d9bc0a6be0b/50189558-2437-48c3-acc5-f9e4a7950b12.png',
    recognize: {
      content: [
        {
          name: 'Smudge the Cat (Smiling Cat Meme)',
          type: 'meme',
          confidence: 95,
          description:
            'A photo of a cat with a digitally altered human-like smile, widely used as a reaction image to convey awkwardness, forced positivity, or discomfort in meme culture.',
        },
      ],
      scene_context:
        "This image is a popular meme known as the 'Smiling Cat' or 'Awkward Cat' reaction image, often used online to humorously express situations where someone is pretending to be okay or is awkwardly smiling through discomfort.",
      meme: {
        is_meme: true,
        template_name: 'Smiling Cat / Awkward Cat reaction',
        meaning:
          'Used to convey forced positivity, awkwardness, or pretending everything is fine in uncomfortable situations.',
        how_a_caption_should_use_it:
          'The caption should describe a situation where someone is pretending to be fine, happy, or okay, while the image delivers the awkward or forced smile. The caption is the setup, and the image is the punchline.',
        image_is_punchline: true,
        image_delivers: 'an awkward, forced smile or pretending to be okay',
        confidence: 0.95,
        example_captions: [
          'When your boss tells a terrible joke and you have to laugh.',
          'Me at family gatherings when someone asks about my love life.',
          "When you say 'no worries' but you're actually very worried.",
        ],
      },
    },
  },
  {
    id: 'fad53736-477c-4102-a5b8-178898eb3a8c',
    name: 'Greyhound in a coat looking awkward/cold',
    url: 'https://images.almostcrackd.ai/2877cb7c-4ef9-4fcc-921c-8ca87d6ed47f/fad53736-477c-4102-a5b8-178898eb3a8c.jpeg',
    recognize: {
      content: [],
      scene_context: '',
      meme: {
        is_meme: true,
        template_name: 'Greyhound in a coat looking awkward/cold',
        meaning:
          'This image is commonly used as a reaction meme to express feelings of discomfort, awkwardness, being unprepared, or being out of place, especially in situations where someone feels exposed or vulnerable.',
        how_a_caption_should_use_it:
          'The caption should set up a scenario where someone feels awkward, out of place, or unprepared, and the image delivers the punchline by visually representing that feeling.',
        image_is_punchline: true,
        image_delivers: 'awkwardness, discomfort, or being unprepared',
        confidence: 0.95,
        example_captions: [
          "When you show up to the party and realize it's formal but you wore pajamas.",
          'Me waiting outside the classroom after arriving way too early.',
          'When you try to blend in but you know you stand out.',
        ],
      },
    },
  },
  {
    id: '2e1d3653-1f48-4f77-8cc4-4d90a55d4131',
    name: 'Dog Riding Roller Coaster',
    url: 'https://images.almostcrackd.ai/f7723182-2371-4417-8702-cfd48d69134d/2e1d3653-1f48-4f77-8cc4-4d90a55d4131.jpeg',
    recognize: {
      content: [
        {
          name: 'Dog Riding Roller Coaster',
          type: 'reaction image',
          confidence: 0.88,
          description:
            'An image of a dog riding a roller coaster with its front paws raised. The image is commonly shared online as a humorous reaction image representing excitement, embracing chaos, or simply going along for the ride.',
        },
      ],
      scene_context:
        'A humorous reaction image depicting a dog enjoying a roller coaster. It is often used to convey feelings of excitement, chaos, or accepting an unpredictable situation.',
      meme: {
        is_meme: true,
        template_name: null,
        template_type: 'reaction image',
        meaning:
          'Represents being caught up in an exciting, chaotic, or unexpected situation while simply enjoying or enduring the ride.',
        how_a_caption_should_use_it:
          "Captions usually describe a situation where someone unexpectedly finds themselves committed to a rapidly unfolding or chaotic experience, with the image serving as the reaction. Examples: 'Me after agreeing to plans without asking for details.' 'When production deploys on Friday and there's no rollback.' 'My brain during finals week.'",
        image_is_punchline: true,
        image_delivers: 'being along for the ride despite uncertainty or chaos',
        confidence: 0.84,
      },
    },
  },
]
