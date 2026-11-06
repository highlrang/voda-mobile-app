import { registerRootComponent } from 'expo';

import App from './App';
import { installAppErrorReporter } from './src/lib/appErrorReporter';

installAppErrorReporter();

registerRootComponent(App);
