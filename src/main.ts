import { Plugin } from 'obsidian';
import { DEFAULT_SETTINGS, type PluginSettings } from './settings.js';
import { mergeSettings } from './utils/merge-settings.js';

export default class ExamplePlugin extends Plugin {
  override settings!: PluginSettings;

  override async onload(): Promise<void> {
    const saved = (await this.loadData()) as Partial<PluginSettings> | null;
    this.settings = mergeSettings(DEFAULT_SETTINGS, saved);
  }

  override onunload(): void {}

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
