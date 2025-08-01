import { app as electronApp, ipcMain } from "electron";
import { overwolf } from "@overwolf/ow-electron";
import EventEmitter from "events";

const app = electronApp as overwolf.OverwolfApp;

/**
 * Service used to register for Game Events,
 * receive games events, and then send them to a window for visual feedback
 *
 */
export class GameEventsService extends EventEmitter {
  private gepApi: overwolf.packages.OverwolfGameEventPackage;
  private activeGame = 0;
  private gepGamesId: number[] = [];

  constructor() {
    super();
    this.registerIPC();
    this.registerOverwolfPackageManager();
  }

  /**
   *  for gep supported games goto:
   *  https://overwolf.github.io/api/electron/game-events/
   *   */
  public registerGames(gepGamesId: number[]) {
    this.emit("log", `register to game events for `, gepGamesId);
    this.gepGamesId = gepGamesId;
  }

  /**
   *
   */
  public async setRequiredFeaturesForAllSupportedGames() {
    await Promise.all(
      this.gepGamesId.map(async (gameId) => {
        try {
          // await this.gepApi.setRequiredFeatures(gameId, ["kill", "death"]);
          // VALORANT で指定可能な ``features`` は ["game_info","me","match_info","kill","death"]
          // ※ ``features`` に ``null`` を指定した場合は、すべての ``features`` が有効になる。
          await this.gepApi.setRequiredFeatures(gameId, null);
        } catch (error) {
          this.emit("log", `error set-required-feature for: ${gameId}`);
        }
      })
    );

    this.emit(
      "log",
      `set-required-feature for games: ${this.gepGamesId.join(",")}`
    );
  }

  public async setRequiredFeaturesForGame(
    gameId: number,
    features: string[] = []
  ) {
    try {
      this.emit("log", `set-required-feature for: ${gameId}`);
      await this.gepApi.setRequiredFeatures(gameId, features);
    } catch (error) {}
  }

  /**
   *
   */
  public async getInfoForActiveGame(): Promise<any> {
    if (this.activeGame == 0) {
      return "getInfo error - no active game";
    }

    return await this.gepApi.getInfo(this.activeGame);
  }

  /**
   * Register the Overwolf Package Manager events
   */
  private registerOverwolfPackageManager() {
    // Once a package is loaded
    app.overwolf.packages.on("ready", (e, packageName, version) => {
      // If this is the GEP package (packageName serves as a UID)
      if (packageName !== "gep") {
        return;
      }

      this.emit("log", `gep package is ready: ${version}`);

      // Prepare for Game Event handling
      this.onGameEventsPackageReady();

      this.emit("ready");
    });
  }

  /**
   * Register listeners for the GEP Package once it is ready
   *
   * @param {overwolf.packages.OverwolfGameEventPackage} gep The GEP Package instance
   */
  private async onGameEventsPackageReady() {
    // Save package into private variable for later access
    this.gepApi = app.overwolf.packages.gep;

    // Remove all existing listeners to ensure a clean slate.
    // NOTE: If you have other classes listening on gep - they'll lose their
    // bindings.
    this.gepApi.removeAllListeners();

    // If a game is detected by the package
    // To check if the game is running in elevated mode, use `gameInfo.isElevate`
    this.gepApi.on("game-detected", (e, gameId, name, gameInfo) => {
      // If the game isn't in our tracking list

      if (!this.gepGamesId.includes(gameId)) {
        // Stops the GEP Package from connecting to the game
        this.emit("log", "gep: skip game-detected", gameId, name, gameInfo.pid);
        return;
      }

      /// if (gameInfo.isElevated) {
      //   // Show message to User?
      //   return;
      // }

      this.emit("log", "gep: register game-detected", gameId, name, gameInfo);
      this.emit("game-launch", gameId);
      e.enable();
      this.activeGame = gameId;

      // in order to start receiving event/info
      // setRequiredFeatures should be set
    });

    // If a game is detected running in elevated mode
    // **Note** - This fires AFTER `game-detected`
    this.gepApi.on("elevated-privileges-required", (e, gameId, ...args) => {
      this.emit("log", "elevated-privileges-required", gameId, ...args);

      // TODO Handle case of Game running in elevated mode (meaning that the app also needs to run in elevated mode in order to detect events)
    });

    // When a new Info Update is fired
    // ``args`` で渡ってくる情報は下記を参照（Native 用の情報になるが、ほぼ同等っぽい）
    // https://dev.overwolf.com/ow-native/live-game-data-gep/supported-games/valorant/
    this.gepApi.on("new-info-update", (e, gameId, ...args) => {
      this.emit("log", "new-info", gameId, ...args);
      this.emit("gep-info", "new-info", gameId, ...args);
    });

    // When a new Game Event is fired
    // ``args`` で渡ってくる情報は下記を参照（Native 用の情報になるが、ほぼ同等っぽい）
    // https://dev.overwolf.com/ow-native/live-game-data-gep/supported-games/valorant/
    this.gepApi.on("new-game-event", (e, gameId, ...args) => {
      this.emit("log", "new-event", gameId, ...args);
      this.emit("gep-event", "new-event", gameId, ...args);
    });

    // If GEP encounters an error
    this.gepApi.on("error", (e, gameId, error, ...args) => {
      this.emit("log", "gep-error", gameId, error, ...args);

      this.activeGame = 0;
    });

    await this.setRequiredFeaturesForAllSupportedGames();
  }

  private registerIPC() {
    ipcMain.handle("gep-set-required-feature", async () => {
      await this.setRequiredFeaturesForAllSupportedGames();
      return true;
    });

    ipcMain.handle("gep-getInfo", async () => {
      return await this.getInfoForActiveGame();
    });
  }
}
