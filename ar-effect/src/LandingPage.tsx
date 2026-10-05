import {
  ArrowUpRight,
  Camera,
} from "lucide-react";

type Props = {
  onOpenProject: (
    path: string
  ) => void;
};

const projects = [
  {
    number: "01",
    title: "Water Ripple",
    description:
      "A camera-based experiment where an open palm disturbs a virtual water surface.",
    tags: [
      "Hand Tracking",
      "WebGL",
      "Interaction",
    ],
    path: "/water-ripple",
    status: "LIVE",
    accent: "pink",
  },

  {
    number: "02",
    title: "Coming Soon",
    description:
      "Another experiment is currently taking shape.",
    tags: [
      "Computer Vision",
      "Creative Coding",
    ],
    path: null,
    status: "WIP",
    accent: "violet",
  },

  {
    number: "03",
    title: "Coming Soon",
    description:
      "Small experiments with cameras, movement, and digital space.",
    tags: [
      "AR",
      "Interaction",
    ],
    path: null,
    status: "WIP",
    accent: "orange",
  },
];

export default function LandingPage({
  onOpenProject,
}: Props) {
  return (
    <main className="relative min-h-screen overflow-hidden bg-black text-white">

      {/* ====================================
          BACKGROUND BLOBS
          ==================================== */}

      <div className="blob blob-pink" />
      <div className="blob blob-violet" />
      <div className="blob blob-orange" />

      {/* ====================================
          NAV
          ==================================== */}

      <nav
        className="
          fixed
          left-0
          right-0
          top-0

          z-50

          flex
          items-center
          justify-between

          px-5
          py-5

          sm:px-8
          sm:py-6

          mix-blend-difference
        "
      >
        <div
          className="
            text-xs
            font-medium
            tracking-[0.25em]
          "
        >
          MINSEY NGUYEN
        </div>

        <div
          className="
            text-xs
            uppercase
            tracking-[0.2em]
            text-zinc-400
          "
        >
          AR / 001
        </div>
      </nav>

      <div
        className="
          relative
          z-10

          mx-auto
          max-w-7xl

          px-5
          sm:px-8
        "
      >

        {/* ==================================
            HERO
            ================================== */}

        <section
          className="
            flex
            min-h-screen
            items-center

            pb-20
            pt-32
          "
        >
          <div className="w-full">

            <div
              className="
                flex
                items-center
                gap-3

                text-xs
                uppercase
                tracking-[0.3em]
                text-zinc-500
              "
            >
              <Camera size={15} />

              Camera-based experiments
            </div>

            <h1
              className="
                mt-6

                max-w-6xl

                text-6xl
                font-bold
                leading-[0.9]
                tracking-[-0.05em]

                sm:text-8xl

                md:text-[10rem]
              "
            >
              AR EFFECT
              <br />

              <span className="animate-gradient bg-gradient-to-r from-pink-400 via-violet-400 to-orange-400 bg-[length:200%] bg-clip-text text-transparent">
                REPOSITORY
              </span>
            </h1>

            <div
              className="
                mt-10

                flex
                flex-col
                gap-8

                md:flex-row
                md:items-end
                md:justify-between
              "
            >

              <p
                className="
                  max-w-2xl

                  text-xl
                  leading-relaxed
                  text-zinc-300

                  sm:text-2xl
                "
              >
                A collection of small
                experiments exploring
                cameras, computer vision,
                interaction, and visual
                effects.
              </p>

              <div
                className="
                  shrink-0

                  text-xs
                  uppercase
                  tracking-[0.2em]
                  text-zinc-500
                "
              >
                2026 —
                <br />
                ongoing
              </div>

            </div>

            <div
              className="
                mt-20

                text-xs
                uppercase
                tracking-[0.25em]
                text-zinc-600
              "
            >
              Scroll to explore ↓
            </div>

          </div>
        </section>


        {/* ==================================
            INTRO
            ================================== */}

        <section
          className="
            grid
            gap-12

            border-t
            border-white/10

            py-24

            md:grid-cols-[1fr_2fr]

            md:py-32
          "
        >

          <div>
            <p
              className="
                text-xs
                uppercase
                tracking-[0.3em]
                text-zinc-500
              "
            >
              What is this?
            </p>
          </div>

          <div>

            <p
              className="
                max-w-4xl

                text-2xl
                leading-relaxed

                sm:text-4xl
              "
            >
              Not a product.
              Not a polished
              case-study collection.
              Just a space to
              experiment.
            </p>

            <p
              className="
                mt-8

                max-w-3xl

                text-base
                leading-relaxed
                text-zinc-400

                sm:text-lg
              "
            >
              This repository is where
              I explore ideas that sit
              somewhere between
              interaction design,
              creative coding,
              computer vision, and
              digital art.
            </p>

          </div>

        </section>


        {/* ==================================
            PROJECTS
            ================================== */}

        <section className="py-24 sm:py-32">

          <div
            className="
              mb-12

              flex
              items-end
              justify-between
            "
          >

            <div>

              <p
                className="
                  text-xs
                  uppercase
                  tracking-[0.3em]
                  text-zinc-500
                "
              >
                Experiments
              </p>

              <h2
                className="
                  mt-4

                  text-4xl
                  font-bold
                  tracking-tight

                  sm:text-6xl
                "
              >
                The Lab
              </h2>

            </div>

            <div
              className="
                hidden
                text-xs
                text-zinc-600

                sm:block
              "
            >
              {projects.length
                .toString()
                .padStart(2, "0")}{" "}
              experiments
            </div>

          </div>


          <div className="space-y-5">

            {projects.map(
              (project) => {

                const active =
                  Boolean(
                    project.path
                  );

                return (
                  <button
                    key={
                      project.number
                    }
                    type="button"
                    disabled={!active}
                    onClick={() => {
                      if (
                        project.path
                      ) {
                        onOpenProject(
                          project.path
                        );
                      }
                    }}
                    className={`
                      group

                      relative

                      w-full

                      overflow-hidden

                      rounded-[2rem]

                      border
                      border-white/10

                      bg-white/[0.03]

                      p-6
                      text-left

                      sm:p-10

                      transition-all
                      duration-500

                      ${
                        active
                          ? "cursor-pointer hover:-translate-y-1 hover:border-white/20 hover:bg-white/[0.06]"
                          : "cursor-default opacity-60"
                      }
                    `}
                  >

                    {/* HOVER GLOW */}

                    <div
                      className={`
                        pointer-events-none

                        absolute
                        -right-24
                        -top-24

                        h-64
                        w-64

                        rounded-full

                        blur-3xl

                        opacity-0

                        transition-opacity
                        duration-500

                        group-hover:opacity-20

                        ${
                          project.accent ===
                          "pink"
                            ? "bg-pink-500"
                            : project.accent ===
                                "violet"
                              ? "bg-violet-500"
                              : "bg-orange-500"
                        }
                      `}
                    />

                    <div
                      className="
                        relative
                        z-10

                        grid
                        gap-8

                        md:grid-cols-[100px_1fr_auto]

                        md:items-center
                      "
                    >

                      {/* NUMBER */}

                      <div
                        className="
                          text-5xl
                          font-bold

                          text-zinc-700

                          transition-colors
                          duration-300

                          group-hover:text-white
                        "
                      >
                        {project.number}
                      </div>


                      {/* CONTENT */}

                      <div>

                        <div
                          className="
                            flex
                            flex-wrap
                            items-center
                            gap-3
                          "
                        >

                          <h3
                            className="
                              text-3xl
                              font-semibold
                              tracking-tight

                              sm:text-4xl
                            "
                          >
                            {
                              project.title
                            }
                          </h3>

                          <span
                            className="
                              rounded-full

                              border
                              border-white/10

                              px-3
                              py-1

                              text-[9px]

                              uppercase
                              tracking-[0.2em]

                              text-zinc-500
                            "
                          >
                            {
                              project.status
                            }
                          </span>

                        </div>

                        <p
                          className="
                            mt-4

                            max-w-2xl

                            text-sm
                            leading-relaxed
                            text-zinc-400

                            sm:text-base
                          "
                        >
                          {
                            project.description
                          }
                        </p>

                        <div
                          className="
                            mt-6

                            flex
                            flex-wrap
                            gap-2
                          "
                        >

                          {project.tags.map(
                            (tag) => (
                              <span
                                key={tag}
                                className="
                                  rounded-full

                                  bg-white/[0.05]

                                  px-3
                                  py-2

                                  text-[10px]

                                  uppercase
                                  tracking-[0.15em]

                                  text-zinc-500
                                "
                              >
                                {tag}
                              </span>
                            )
                          )}

                        </div>

                      </div>


                      {/* ACTION */}

                      <div
                        className="
                          flex
                          items-center
                          gap-2

                          text-sm
                          text-zinc-500

                          transition-all
                          duration-300

                          group-hover:text-white
                        "
                      >
                        {active
                          ? "Explore"
                          : "Coming soon"}

                        {active && (
                          <ArrowUpRight
                            size={18}
                            className="
                              transition-transform
                              duration-300

                              group-hover:translate-x-1
                              group-hover:-translate-y-1
                            "
                          />
                        )}

                      </div>

                    </div>

                  </button>
                );
              }
            )}

          </div>

        </section>


        {/* ==================================
            PHILOSOPHY
            ================================== */}

        <section
          className="
            relative

            overflow-hidden

            border-y
            border-white/10

            py-24

            sm:py-40
          "
        >

          <div
            className="
              pointer-events-none

              absolute
              -right-20
              top-0

              text-[10rem]
              font-black

              leading-none

              text-white/[0.025]

              sm:text-[18rem]
            "
          >
            PLAY
          </div>

          <div
            className="
              relative
              z-10

              max-w-5xl
            "
          >

            <p
              className="
                text-xs
                uppercase
                tracking-[0.3em]
                text-zinc-500
              "
            >
              Why I make these
            </p>

            <p
              className="
                mt-8

                text-3xl
                font-medium
                leading-tight

                sm:text-5xl
                md:text-6xl
              "
            >
              I like the moment when
              technology stops feeling
              like technology and starts
              feeling like{" "}
              <span className="text-pink-400">
                magic.
              </span>
            </p>

          </div>

        </section>


        {/* ==================================
            FOOTER
            ================================== */}

        <footer
          className="
            flex
            flex-col
            gap-6

            py-16

            text-sm
            text-zinc-500

            sm:flex-row
            sm:items-center
            sm:justify-between
          "
        >

          <div>
            AR EFFECT REPOSITORY
            <span className="mx-2">
              /
            </span>
            MINSEY NGUYEN
          </div>

          <a
            href="https://github.com/chauminh24"
            target="_blank"
            rel="noopener noreferrer"
            className="
              flex
              items-center
              gap-2

              transition-colors

              hover:text-white
            "
          >
            <i className="fab fa-github" style={{ fontSize: '15px' }} />

            GitHub
          </a>

        </footer>

        <div className="h-10" />

      </div>
    </main>
  );
}