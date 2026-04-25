import { Composition } from 'remotion'
import { TitleCard, titleCardSchema } from './compositions/TitleCard'
import { Slideshow, slideshowSchema } from './compositions/Slideshow'
import { VideoWithTitle, videoWithTitleSchema } from './compositions/VideoWithTitle'
import { AudioVisualizer, audioVisualizerSchema } from './compositions/AudioVisualizer'
import { LowerThird, lowerThirdSchema } from './compositions/LowerThird'
import { AnimatedCaptions, animatedCaptionsSchema } from './compositions/AnimatedCaptions'
import { KineticText, kineticTextSchema } from './compositions/KineticText'

export function Root() {
  return (
    <>
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
    </>
  )
}
