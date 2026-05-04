import { Composition } from 'remotion'
import { BrandAd, brandAdSchema } from './compositions/BrandAd'
import { PaperCanvas, paperCanvasSchema } from './compositions/PaperCanvas'
import { PhysicsScene, physicsSceneSchema } from './compositions/PhysicsScene'
import { TitleCard, titleCardSchema } from './compositions/TitleCard'
import { Slideshow, slideshowSchema } from './compositions/Slideshow'
import { VideoWithTitle, videoWithTitleSchema } from './compositions/VideoWithTitle'
import { AudioVisualizer, audioVisualizerSchema } from './compositions/AudioVisualizer'
import { LowerThird, lowerThirdSchema } from './compositions/LowerThird'
import { AnimatedCaptions, animatedCaptionsSchema } from './compositions/AnimatedCaptions'
import { KineticText, kineticTextSchema } from './compositions/KineticText'
import { HtmlInCanvasGlitch, htmlInCanvasGlitchSchema } from './compositions/HtmlInCanvasGlitch'

export function Root() {
  return (
    <>
      <Composition
        id="BrandAd"
        component={BrandAd}
        durationInFrames={240}
        fps={30}
        width={1920}
        height={1080}
        schema={brandAdSchema}
        defaultProps={{
          logoSrc: 'monet-mark.svg',
          tagline: 'Edit smarter. Create faster.',
          cta: 'Try Monet Today',
          backgroundColor: '#0a0b0e',
          accentColor: '#7aa2f7',
          textColor: '#e8eaed',
        }}
      />
      <Composition
        id="PaperCanvas"
        component={PaperCanvas}
        durationInFrames={300}
        fps={30}
        width={1920}
        height={1080}
        schema={paperCanvasSchema}
        defaultProps={{
          script: [
            'project.clear();',
            'var t2 = frame / 300;',
            'for (var i = 0; i < 12; i++) {',
            '  var angle = (i / 12) * Math.PI * 2 + t2 * Math.PI * 2;',
            '  var r = 80 + Math.sin(frame * 0.05 + i) * 20;',
            '  var x = width / 2 + Math.cos(angle) * 300;',
            '  var y = height / 2 + Math.sin(angle) * 300;',
            '  new Path.Circle({ center: [x, y], radius: r, fillColor: new Color(i / 12, 0.7, 0.9) });',
            '}',
          ].join('\n'),
          backgroundColor: '#0f1115',
        }}
      />
      <Composition
        id="PhysicsScene"
        component={PhysicsScene}
        durationInFrames={300}
        fps={30}
        width={1920}
        height={1080}
        schema={physicsSceneSchema}
        defaultProps={{
          setupScript: [
            'engine.gravity.y = 1;',
            'var ground = Bodies.rectangle(width/2, height-25, width, 50, { isStatic: true, render: { fillStyle: "#334155" } });',
            'var wall1 = Bodies.rectangle(25, height/2, 50, height, { isStatic: true, render: { fillStyle: "#1e293b" } });',
            'var wall2 = Bodies.rectangle(width-25, height/2, 50, height, { isStatic: true, render: { fillStyle: "#1e293b" } });',
            'var balls = [];',
            'for (var i = 0; i < 8; i++) {',
            '  var r = 30 + Math.random() * 40;',
            '  var colors = ["#5b82f7","#f07178","#8bd49c","#e6c073","#c79bf0","#7dcfff"];',
            '  balls.push(Bodies.circle(200 + i * 200, 50 + i * 40, r, {',
            '    restitution: 0.7, friction: 0.1,',
            '    render: { fillStyle: colors[i % colors.length] }',
            '  }));',
            '}',
            'Composite.add(world, [ground, wall1, wall2, ...balls]);',
          ].join('\n'),
          backgroundColor: '#111318',
          wireframes: false,
          showVelocity: false,
        }}
      />
      <Composition
        id="TitleCard"
        component={TitleCard}
        durationInFrames={150}
        fps={30}
        width={1920}
        height={1080}
        schema={titleCardSchema}
        defaultProps={{
          title: 'Your Title Here',
          subtitle: 'Your subtitle here',
          backgroundColor: '#0f1115',
          textColor: '#e8eaed',
          accentColor: '#7aa2f7',
        }}
      />
      <Composition
        id="Slideshow"
        component={Slideshow}
        durationInFrames={300}
        fps={30}
        width={1920}
        height={1080}
        schema={slideshowSchema}
        defaultProps={{
          images: [],
          frameDuration: 90,
          transitionDuration: 20,
          backgroundColor: '#0f1115',
        }}
      />
      <Composition
        id="VideoWithTitle"
        component={VideoWithTitle}
        durationInFrames={300}
        fps={30}
        width={1920}
        height={1080}
        schema={videoWithTitleSchema}
        defaultProps={{
          videoSrc: '',
          title: 'Your Title',
          subtitle: 'Your subtitle',
          titlePosition: 'bottom',
          overlayOpacity: 0.5,
          textColor: '#ffffff',
          accentColor: '#7aa2f7',
        }}
      />
      <Composition
        id="AudioVisualizer"
        component={AudioVisualizer}
        durationInFrames={300}
        fps={30}
        width={1920}
        height={1080}
        schema={audioVisualizerSchema}
        defaultProps={{
          audioSrc: '',
          title: '',
          barCount: 64,
          barColor: '#7aa2f7',
          barColorPeak: '#f07178',
          backgroundColor: '#0f1115',
          textColor: '#e8eaed',
          mirror: true,
        }}
      />
      <Composition
        id="LowerThird"
        component={LowerThird}
        durationInFrames={180}
        fps={30}
        width={1920}
        height={1080}
        schema={lowerThirdSchema}
        defaultProps={{
          name: 'John Doe',
          title: 'Executive Producer',
          accentColor: '#7aa2f7',
          textColor: '#ffffff',
          backgroundColor: 'rgba(0,0,0,0)',
          position: 'left',
          holdDuration: 120,
        }}
      />
      <Composition
        id="AnimatedCaptions"
        component={AnimatedCaptions}
        durationInFrames={300}
        fps={30}
        width={1920}
        height={1080}
        schema={animatedCaptionsSchema}
        defaultProps={{
          words: [
            { word: 'Add', startFrame: 0, endFrame: 20 },
            { word: 'your', startFrame: 20, endFrame: 40 },
            { word: 'captions', startFrame: 40, endFrame: 60 },
            { word: 'here', startFrame: 60, endFrame: 80 },
          ],
          backgroundColor: 'rgba(0,0,0,0)',
          textColor: '#ffffff',
          highlightColor: '#7aa2f7',
          fontSize: 72,
          position: 'bottom',
        }}
      />
      <Composition
        id="KineticText"
        component={KineticText}
        durationInFrames={180}
        fps={30}
        width={1920}
        height={1080}
        schema={kineticTextSchema}
        defaultProps={{
          text: 'Make something amazing',
          backgroundColor: '#0f1115',
          textColor: '#e8eaed',
          accentColor: '#7aa2f7',
          fontSize: 120,
          staggerFrames: 4,
          animationStyle: 'rise',
        }}
      />
      <Composition
        id="HtmlInCanvasGlitch"
        component={HtmlInCanvasGlitch}
        durationInFrames={180}
        fps={30}
        width={1920}
        height={1080}
        schema={htmlInCanvasGlitchSchema}
        defaultProps={{
          title: 'GLITCH',
          subtitle: 'powered by HTML-in-canvas',
          backgroundColor: '#0a0b0e',
          textColor: '#e8eaed',
          accentColor: '#f07178',
          glitchIntensity: 12,
        }}
      />
    </>
  )
}
