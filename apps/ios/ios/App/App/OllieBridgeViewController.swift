// OllieBridgeViewController.swift
//
// Capacitor bridge view controller subclass. Its only job is to register
// Ollie's app-local plugins in `capacitorDidLoad()` — the Capacitor 7
// hook for wiring plugins that are not distributed as CocoaPods.
//
// Main.storyboard's root view controller is set to this class (custom
// class = OllieBridgeViewController, module = App) instead of the stock
// CAPBridgeViewController.

import Capacitor

class OllieBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(OllieAIPlugin())
    }
}
