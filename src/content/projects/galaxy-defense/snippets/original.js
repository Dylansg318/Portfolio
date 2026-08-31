// Create your variables here
var score = 0;
var baseHealth = 8;
var baseHealth2 = 8;
var baseHealth3 = 8;
var lives = 3;
var FTL = 0;
var bomb = 0;
var alien6health = 2;
var projectileLoop = 0;

// Create your sprites here
var spaceship = createSprite(200, 300);
spaceship.setAnimation("spaceShip");
spaceship.scale = 0.5;
var alien = createSprite(randomNumber(10,390), -15);
alien.setAnimation("alien");
alien.scale = 0.5;
var alien2 = createSprite(randomNumber(10,390), -15);
alien2.setAnimation("alien");
alien2.scale = 0.5;
var alien3 = createSprite(randomNumber(10,390), -15);
alien3.setAnimation("alien");
alien3.scale = 0.5;
var alien4 = createSprite(randomNumber(10,390), -15);
alien4.setAnimation("alien");
alien4.scale = 0.5;
var alien5 = createSprite(randomNumber(10,390), -15);
alien5.setAnimation("alien");
alien5.scale = 0.5;
var alien6 = createSprite(0, 0);
alien6.setAnimation("angryAlien");
alien6.scale = 0.5;
var homeBase = createSprite(200, 390);
homeBase.setAnimation("homeBase_1");
var homeBase2 = createSprite(55, 390);
homeBase2.setAnimation("homeBase_1");
var homeBase3 = createSprite(345, 390);
homeBase3.setAnimation("homeBase_1");
var projectile = createSprite(spaceship.x, spaceship.y);
projectile.setAnimation("projectile");
projectile.velocityY = -5;
projectile.setCollider("rectangle", 0, 0, 5, 6);
var projectile2 = createSprite(spaceship.x, spaceship.y);
projectile2.setAnimation("projectile");
projectile2.velocityY = -5;
projectile2.setCollider("rectangle", 0, 0, 5, 6);
var projectile3 = createSprite(spaceship.x, spaceship.y);
projectile3.setAnimation("projectile");
projectile3.velocityY = -5;
projectile3.setCollider("rectangle", 0, 0, 5, 6);
var bombo = createSprite(randomNumber(10,390), -15);
bombo.setAnimation("bomb");
bombo.velocityY = 1;
bombo.setCollider("rectangle", 0, 0, 8, 8);
var bombStore = createSprite(55, 195);
bombStore.setAnimation("bomb");
var livesStore = createSprite(200, 200);
livesStore.setAnimation("spaceShip");
livesStore.scale = 0.3;
var homeStore = createSprite(350, 210);
homeStore.setAnimation("homeBase_1");
function draw() {
  // draw background
  backGround1();
  textScore();

  // update sprites
  startGame();
  levels();
  playerMovement();
  alienShot();
  store();
  spaceshipLife();
  homeHealth();
  restartGame();

  drawSprites();

}

// Create your functions here
function startGame() {
  if (keyDown("h")) {
    //pressing 'h' shows instructions
    textSize(18);
text("How to Play: ", 2, 60);
text("Use arrow keys to move ", 2, 90);
text("Press 'space' to shoot", 2, 120);
textSize(13);
text("(You can only shoot one bullet at a time so shoot wisely)", 2, 133);
textSize(18);
text("Press 'q' when FTL Drive is 100% to teleport ", 2, 160);
text("Press 'e' with a bomb to destory all aliens for 3 points", 2, 190);
text("Press 'r' to restart ", 2, 220);
    text("Hold 't' to access store", 2, 250);

    //resets sprites until h is no longer held.
    alien.y = -15;
    alien2.y = -15;
    alien3.y = -15;
    alien4.y = -15;
    alien5.y = -15;
    alien6.y = -50;
    spaceship.x = 200;
    spaceship.y = 300;
    bombo.x = randomNumber (10,390);
    bombo.y = randomNumber (-400,-600);
  }
}
function store() {
  if (keyDown("t")) {
    //Sets up the store
    textSize(20);
    text("Store:", 180, 100);
    textSize(15);
    text("Type Desired Number to Buy", 120, 115);
    textSize(15);
    text("1. Bombs", 25, 180);
    text("20 Points", 30, 225);
    text("2. Lives", 175, 180);
    text("50 Points", 172, 230);
    text("3. Heal All Bases", 295, 180);
    text("200 Points", 320, 230);
    //Ensures that the score is above or equal to the required price of the item
    if (score >= 20) {
      if (keyWentDown("1")) {
        //Buys a bomb when 1 is pressed and uses points
        bomb = bomb + 1;
        score = score - 20;
      }
      if (score >= 50) {
        if (keyWentDown("2")) {
          //Buys a bomb when 2 is pressed and uses points
          lives = lives + 1;
          score = score - 50;
        }
      }
      if (score >= 200) {
        if (keyWentDown("3")) {
          //Heals all the bases to full when 3 is pressed and uses points
          baseHealth = 8 ;
          baseHealth2 = 8 ;
          baseHealth3 = 8 ;
          score = score - 200;
        }
      }
    }
    //Makes the store sprites visible
    bombStore.visible = 1;
    livesStore.visible = 1;
    homeStore.visible = 1;
    spaceship.visible = 1;
    alien.y = -15;
    alien2.y = -15;
    alien3.y = -15;
    alien4.y = -15;
    alien5.y = -15;
    //resets alien6 to the top of the screen
    alien6health = 0;
    spaceship.x = 200;
    spaceship.y = 300;
    bombo.x = randomNumber (10,390);
    bombo.y = randomNumber (-400,-600);
    homeBase.visible = 1;
    homeBase2.visible = 1;
    homeBase3.visible = 1;
    projectile.visible = 1;
    bombo.visible = 1;
  }
}
function levels() {
  if  (score >= 30 == alien6.x >= 400) {
    //Makes alien6 bounce across the screen
    alien6.setVelocity(-5 , 0.5);
  }
  if  (score >= 30 == alien6.x <= 0) {
    //Makes alien6 bounce across the screen
    alien6.setVelocity(5 , 0.5);
  }
  if (score >= 50) {
    //Speeds up all the aliens when 50 is reached
    alien.velocityY = randomNumber(1.5, 2);
    alien2.velocityY = randomNumber(1.5, 2);
    alien3.velocityY = randomNumber(1.5, 2);
    alien4.velocityY = randomNumber(1.5, 2);
    alien5.velocityY = randomNumber(1.5,2);
  } else {
    alien.velocityY = randomNumber(1, 1.5);
    alien2.velocityY = randomNumber(1, 1.5);
    alien3.velocityY = randomNumber(1, 1.5);
    alien4.velocityY = randomNumber(1, 1.5);
    alien5.velocityY = randomNumber(1,1.5);
  }
  if (score >= 50) {
    //Changes Background when the score is 50
    bombStore.visible = 0;
    livesStore.visible = 0;
    homeStore.visible = 0;
    background("black");
    fill("blue");
    //Makes stars
    ellipse(randomNumber(5,395), randomNumber(5,395), 5, 5);
    ellipse(randomNumber(5,395), randomNumber(5,395), 5, 5);
    ellipse(randomNumber(5,395), randomNumber(5,395), 5, 5);
    ellipse(randomNumber(5,395), randomNumber(5,395), 5, 5);
    ellipse(randomNumber(5,395), randomNumber(5,395), 5, 5);
    ellipse(randomNumber(5,395), randomNumber(5,395), 5, 5);
    ellipse(randomNumber(5,395), randomNumber(5,395), 5, 5);
    ellipse(randomNumber(5,395), randomNumber(5,395), 5, 5);
    ellipse(randomNumber(5,395), randomNumber(5,395), 5, 5);
    ellipse(randomNumber(5,395), randomNumber(5,395), 5, 5);
    ellipse(randomNumber(5,395), randomNumber(5,395), 5, 5);
    ellipse(randomNumber(5,395), randomNumber(5,395), 5, 5);
    ellipse(randomNumber(5,395), randomNumber(5,395), 5, 5);
    ellipse(randomNumber(5,395), randomNumber(5,395), 5, 5);
    ellipse(randomNumber(5,395), randomNumber(5,395), 5, 5);
    ellipse(randomNumber(5,395), randomNumber(5,395), 5, 5);
    ellipse(randomNumber(5,395), randomNumber(5,395), 5, 5);
    ellipse(randomNumber(5,395), randomNumber(5,395), 5, 5);
    textScore();
  }
}
function backGround1() {
  //Creates the first background
  bombStore.visible = 0;
  livesStore.visible = 0;
  homeStore.visible = 0;
  background("black");
  fill("yellow");
  //Makes stars
  ellipse(randomNumber(5,395), randomNumber(5,395), 5, 5);
  ellipse(randomNumber(5,395), randomNumber(5,395), 5, 5);
  ellipse(randomNumber(5,395), randomNumber(5,395), 5, 5);
  ellipse(randomNumber(5,395), randomNumber(5,395), 5, 5);
  ellipse(randomNumber(5,395), randomNumber(5,395), 5, 5);
  ellipse(randomNumber(5,395), randomNumber(5,395), 5, 5);
  ellipse(randomNumber(5,395), randomNumber(5,395), 5, 5);
  ellipse(randomNumber(5,395), randomNumber(5,395), 5, 5);
  ellipse(randomNumber(5,395), randomNumber(5,395), 5, 5);
  ellipse(randomNumber(5,395), randomNumber(5,395), 5, 5);
  ellipse(randomNumber(5,395), randomNumber(5,395), 5, 5);
  ellipse(randomNumber(5,395), randomNumber(5,395), 5, 5);
  ellipse(randomNumber(5,395), randomNumber(5,395), 5, 5);
  ellipse(randomNumber(5,395), randomNumber(5,395), 5, 5);
  ellipse(randomNumber(5,395), randomNumber(5,395), 5, 5);
  ellipse(randomNumber(5,395), randomNumber(5,395), 5, 5);
  ellipse(randomNumber(5,395), randomNumber(5,395), 5, 5);
  ellipse(randomNumber(5,395), randomNumber(5,395), 5, 5);
}
function textScore() {
  //Adds text for score, lives, FTL, bombs, title, and subtitle.
  textSize(17);
  text("Points:", 5, 360);
  text(score, 70, 360);
  text("Lives:", 5, 330);
  text(lives, 70, 330);
  text("FTL Drive:         %", 240, 360);
  text(FTL, 330, 360);
  text("Bombs:", 240, 330);
  text(bomb, 330, 330);
  textSize(30);
  textFont("impact");
  fill(19,157,8);
  text("Galaxy Defense", 118, 30);
  textSize(14);
text("(hold 'h' for help)", 160, 45);
}
function playerMovement() {
  if (FTL <= 0) {
    //Ensures the FTL doesn't become negative
    FTL = 0;
  }
  if (FTL >= 0) {
    // Adds FTL % every frame
    FTL = FTL + 1;
    //Moves the spaceship normally
    if (keyDown("right")) {
      spaceship.x = spaceship.x + 4;
    }
    if ((keyDown("left"))) {
      spaceship.x = spaceship.x - 4;
    }
    if ((keyDown("up"))) {
      spaceship.y = spaceship.y - 4;
    }
    if ((keyDown("down"))) {
      spaceship.y = spaceship.y + 4;
    }
  }
  if (FTL > 100) {
    //Keeps the FTL at 100
    FTL = 100;
    if (keyDown("q")) {
      //Makes the spaceship teleport when q and an arrow key is pressed
      if (keyDown("right")) {
        spaceship.x = spaceship.x + 100;
        FTL = FTL - 98;
      }
      if (keyDown("left")) {
        spaceship.x = spaceship.x - 100;
        FTL = FTL - 99;
      }
      if (keyDown("up")) {
        spaceship.y = spaceship.y - 100;
        FTL = FTL - 99;
      }
      if (keyDown("down")) {
        spaceship.y = spaceship.y + 100;
        FTL = FTL - 99;
      }
    }
  }
  if (keyWentDown("space")) {
    //shoots projectiles using a loop between 3 different sprites
    if (projectileLoop == 0) {
      projectile.x = spaceship.x;
      projectile.y = spaceship.y;
      projectileLoop = projectileLoop + 1;
    } else {
      if (projectileLoop == 1) {
        projectile2.x = spaceship.x;
        projectile2.y = spaceship.y;
        projectileLoop = projectileLoop + 1;
      } else {
        if (projectileLoop == 2) {
          projectile3.x = spaceship.x;
          projectile3.y = spaceship.y;
          projectileLoop = projectileLoop - 2;
        }
      }
    }
  }
  if (bomb >= 1) {
    if (keyWentDown("e")) {
      //Resets all aliens and gives 4 points
      alien.x = (randomNumber(10,390));
      alien.y = -15;
      score = score + 4;
      bomb = bomb - 1;
      alien2.x = (randomNumber(10,390));
      alien2.y = -15;
      alien3.x = (randomNumber(10,390));
      alien3.y = -15;
      alien4.x = (randomNumber(10,390));
      alien4.y = -15;
      alien5.x = (randomNumber(10,390));
      alien5.y = -15;
      alien6health = 0;
    }
  }
}
function alienShot() {
  //Resets each alien when it touches the 3 projectiles
  if (alien5.isTouching(projectile)) {
  alien5.x = (randomNumber(10,390));
  alien5.y = -15;
  score = score + 1;
}
if (alien5.isTouching(projectile2)) {
  alien5.x = (randomNumber(10,390));
  alien5.y = -15;
  score = score + 1;
}
if (alien5.isTouching(projectile3)) {
  alien5.x = (randomNumber(10,390));
  alien5.y = -15;
  score = score + 1;
}
  if (alien4.isTouching(projectile)) {
  alien4.x = (randomNumber(10,390));
  alien4.y = -15;
  score = score + 1;
}
if (alien4.isTouching(projectile2)) {
  alien4.x = (randomNumber(10,390));
  alien4.y = -15;
  score = score + 1;
}
if (alien4.isTouching(projectile3)) {
  alien4.x = (randomNumber(10,390));
  alien4.y = -15;
  score = score + 1;
}
  if (alien3.isTouching(projectile)) {
    alien3.x = (randomNumber(10,390));
    alien3.y = -15;
    score = score + 1;
  }
  if (alien3.isTouching(projectile2)) {
    alien3.x = (randomNumber(10,390));
    alien3.y = -15;
    score = score + 1;
  }
  if (alien3.isTouching(projectile3)) {
    alien3.x = (randomNumber(10,390));
    alien3.y = -15;
    score = score + 1;
  }
  //Gives a bomb when the spaceship touches a bomb sprite
  if (spaceship.isTouching(bombo)) {
    bombo.x = randomNumber (10,390);
    bombo.y = randomNumber (-400,-600);
    bomb = bomb + 1;
  }
  if (alien.isTouching(projectile)) {
    alien.x = (randomNumber(10,390));
    alien.y = -15;
    score = score + 1;
  }
  if (alien.isTouching(projectile2)) {
    alien.x = (randomNumber(10,390));
    alien.y = -15;
    score = score + 1;
  }
  if (alien.isTouching(projectile3)) {
    alien.x = (randomNumber(10,390));
    alien.y = -15;
    score = score + 1;
  }
  if (alien2.isTouching(projectile)) {
    alien2.x = (randomNumber(10,390));
    alien2.y = -15;
    score = score + 1;
  }
  if (alien2.isTouching(projectile2)) {
    alien2.x = (randomNumber(10,390));
    alien2.y = -15;
    score = score + 1;
  }
  if (alien2.isTouching(projectile3)) {
    alien2.x = (randomNumber(10,390));
    alien2.y = -15;
    score = score + 1;
  }
  //Lowers down the baseHealth when an alien touches one
  if (alien.isTouching(homeBase)) {
    alien.x = randomNumber(10,390);
    alien.y = -15;
    baseHealth = baseHealth - 1;
  }
  if (alien.isTouching(homeBase2)) {
    alien.x = (randomNumber(10,390));
    alien.y = -15;
    baseHealth2 = baseHealth2 - 1;
  }
  if (alien.isTouching(homeBase3)) {
    alien.x = (randomNumber(10,390));
    alien.y = -15;
    baseHealth3 = baseHealth3 - 1;
  }
  if (alien2.isTouching(projectile)) {
    alien2.x = (randomNumber(10,390));
    alien2.y = -15;
    score = score + 1;
  }
  if (alien2.isTouching(homeBase)) {
    alien2.x = randomNumber(10,390);
    alien2.y = -15;
    baseHealth = baseHealth - 1;
  }
  if (alien2.isTouching(homeBase2)) {
    alien2.x = randomNumber(10,390);
    alien2.y = -15;
    baseHealth2 = baseHealth2 - 1;
  }
  if (alien2.isTouching(homeBase3)) {
    alien2.x = (randomNumber(10,390));
    alien2.y = -15;
    baseHealth3 = baseHealth3 - 1;
  }
  if (alien3.isTouching(projectile)) {
    alien3.x = (randomNumber(10,390));
    alien3.y = -15;
    score = score + 1;
  }
  if (alien3.isTouching(homeBase)) {
  alien3.x = randomNumber(10,390);
  alien3.y = -15;
  baseHealth = baseHealth - 1;
}
if (alien3.isTouching(homeBase2)) {
  alien3.x = (randomNumber(10,390));
  alien3.y = -15;
  baseHealth2 = baseHealth2 - 1;
}
if (alien3.isTouching(homeBase3)) {
  alien3.x = (randomNumber(10,390));
  alien3.y = -15;
  baseHealth3 = baseHealth3 - 1;
}
  if (alien4.isTouching(projectile)) {
    alien4.x = randomNumber(10,390);
    alien4.y = -15;
    score = score + 1;
  }
  if (alien4.isTouching(homeBase)) {
  alien4.x = randomNumber(10,390);
  alien4.y = -15;
  baseHealth = baseHealth - 1;
}
if (alien4.isTouching(homeBase2)) {
  alien4.x = (randomNumber(10,390));
  alien4.y = -15;
  baseHealth2 = baseHealth2 - 1;
}
if (alien4.isTouching(homeBase3)) {
  alien4.x = (randomNumber(10,390));
  alien4.y = -15;
  baseHealth3 = baseHealth3 - 1;
}
  if (alien5.isTouching(projectile)) {
    alien5.x = (randomNumber(10,390));
    alien5.y = -15;
    score = score + 1;
  }
  if (alien5.isTouching(homeBase)) {
  alien5.x = randomNumber(10,390);
  alien5.y = -15;
  baseHealth = baseHealth - 1;
}
if (alien5.isTouching(homeBase2)) {
  alien5.x = (randomNumber(10,390));
  alien5.y = -15;
  baseHealth2 = baseHealth2 - 1;
}
  if (alien5.isTouching(homeBase3)) {
  alien5.x = (randomNumber(10,390));
  alien5.y = -15;
  baseHealth3 = baseHealth3 - 1;
}
  //Resets alien6 only when it is hit twice by a projectile
  if (alien6health <= 0) {
    alien6.x = 0;
    alien6.y = -50;
    alien6health = 2;
    if (alien6.isTouching(projectile)) {
      score = score + 1;
    }
    alien6.setAnimation("angryAlien");
  }
  if (alien6health > 0) {
    if (alien6.isTouching(projectile)) {
    alien6health = alien6health - 1;
    alien6.setAnimation("alien");
    projectile.y = spaceship.y;
    projectile.x = spaceship.x;
}
if (alien6health <= 0) {
  alien6.x = 0;
  alien6.y = -50;
  alien6health = 2;
  if (alien6.isTouching(projectile2)) {
    score = score + 1;
  }
  alien6.setAnimation("angryAlien");
}
if (alien6health > 0) {
  if (alien6.isTouching(projectile)) {
  alien6health = alien6health - 1;
  alien6.setAnimation("alien");
  projectile.y = spaceship.y;
  projectile.x = spaceship.x;
}
}
  }
  if (alien6.isTouching(homeBase)) {
  alien6.x = (0);
  alien6.y = -50;
  baseHealth = baseHealth - 2;
}
if (alien6.isTouching(homeBase2)) {
  alien6.x = (0);
  alien6.y = -50;
  baseHealth2 = baseHealth2 - 2;
}
if (alien6.isTouching(homeBase3)) {
  alien6.x = (0);
  alien6.y = -50;
  baseHealth3 = baseHealth3 - 2;
}
}
function spaceshipLife() {
  //Removes a life if the spaceship hits an alien
  if (alien.isTouching(spaceship)) {
    alien.x = randomNumber(10,390);
    alien.y = -15;
    lives = lives - 1;
    spaceship.x = 200;
    spaceship.y = 300;
  }
  if (alien2.isTouching(spaceship)) {
    alien2.x = (randomNumber(10,390));
    alien2.y = -15;
    lives = lives - 1;
    spaceship.x = 200;
    spaceship.y = 300;
  }
  if (alien3.isTouching(spaceship)) {
    alien3.x = (randomNumber(10,390));
    alien3.y = -15;
    lives = lives - 1;
    spaceship.x = 200;
    spaceship.y = 300;
  }
  if (alien4.isTouching(spaceship)) {
    alien4.x = randomNumber(10,390);
    alien4.y = -15;
    lives = lives - 1;
    spaceship.x = 200;
    spaceship.y = 300;
  }
  if (alien5.isTouching(spaceship)) {
    alien5.x = (randomNumber(10,390));
    alien5.y = -15;
    lives = lives - 1;
    spaceship.x = 200;
    spaceship.y = 300;
  }
  if (alien6.isTouching(spaceship)) {
    lives = lives - 1;
    alien6health = alien6health - 1;
    spaceship.x = 200;
    spaceship.y = 300;
  }

}
function homeHealth() {
  //Changes the animation of each base when they are hit
  if (baseHealth == 1) {
    homeBase.setAnimation("homeBase_8");
  }
  if (baseHealth == 2) {
    homeBase.setAnimation("homeBase_7");
  }
  if (baseHealth == 3) {
    homeBase.setAnimation("homeBase_6");
  }
  if (baseHealth == 4) {
    homeBase.setAnimation("homeBase_5");
  }
  if (baseHealth == 5) {
    homeBase.setAnimation("homeBase_4");
  }
  if (baseHealth == 6) {
    homeBase.setAnimation("homeBase_3");
  }
  if (baseHealth == 7) {
    homeBase.setAnimation("homeBase_2");
  }
  if (baseHealth == 8) {
    homeBase.setAnimation("homeBase_1");
  }
  if (baseHealth2 == 1) {
  homeBase2.setAnimation("homeBase_8");
}
if (baseHealth2 == 2) {
  homeBase2.setAnimation("homeBase_7");
}
if (baseHealth2 == 3) {
  homeBase2.setAnimation("homeBase_6");
}
if (baseHealth2 == 4) {
  homeBase2.setAnimation("homeBase_5");
}
if (baseHealth2 == 5) {
  homeBase2.setAnimation("homeBase_4");
}
if (baseHealth2 == 6) {
  homeBase2.setAnimation("homeBase_3");
}
if (baseHealth2 == 7) {
  homeBase.setAnimation("homeBase_2");
}
if (baseHealth2 == 8) {
  homeBase2.setAnimation("homeBase_1");
}
if (baseHealth3 == 1) {
  homeBase3.setAnimation("homeBase_8");
}
if (baseHealth3 == 2) {
  homeBase3.setAnimation("homeBase_7");
}
if (baseHealth3 == 3) {
  homeBase3.setAnimation("homeBase_6");
}
if (baseHealth3 == 4) {
  homeBase3.setAnimation("homeBase_5");
}
if (baseHealth3 == 5) {
  homeBase3.setAnimation("homeBase_4");
}
if (baseHealth3 == 6) {
  homeBase3.setAnimation("homeBase_3");
}
if (baseHealth3 == 7) {
  homeBase3.setAnimation("homeBase_2");
}
if (baseHealth3 == 8) {
  homeBase3.setAnimation("homeBase_1");
}
}
function restartGame() {
  //Ends the game when all bases are destroyed
  if (baseHealth <= 0) {
    if (baseHealth2 <= 0) {
      if (baseHealth3 <= 0) {
        homeBase.visible = 0;
        homeBase2.visible = 0;
        homeBase3.visible = 0;
        background("black");
        fill("white");
        textSize(50);
        text("GAME OVER", 83, 200);
        textSize(25);
        text("press 'r' to restart", 100, 220);
        spaceship.visible = 0;
        alien.visible = 0;
        alien2.visible = 0;
        alien3.visible = 0;
        alien4.visible = 0;
        alien5.visible = 0;
        alien6.visible = 0;
        projectile.visible = 0;
        bombo.visible = 0;
      }
    }
  }
  //Ends the game if player runs out of lives
  if (lives <= 0) {
    homeBase.visible = 0;
    homeBase2.visible = 0;
    homeBase3.visible = 0;
    background("black");
    fill("white");
    textSize(50);
    text("GAME OVER", 83, 200);
    textSize(25);
    text("press 'r' to restart", 100, 223);
    spaceship.visible = 0;
    alien.visible = 0;
    alien2.visible = 0;
    alien3.visible = 0;
    alien4.visible = 0;
    alien5.visible = 0;
    alien6.visible = 0;
    projectile.visible = 0;
    bombo.visible = 0;
  }
  if (keyWentDown("r")) {
    //Resets the game if r is pressed
    spaceship.visible = 1;
    alien.visible = 1;
    alien2.visible = 1;
    alien3.visible = 1;
    alien4.visible = 1;
    alien5.visible = 1;
    alien6.visible = 1;
    alien6.x = 0;
    alien6.y = -50;
    alien.x = (randomNumber(10,390));
    alien.y = -15;
    alien2.x = (randomNumber(10,390));
    alien2.y = -15;
    alien3.x = (randomNumber(10,390));
    alien3.y = -15;
    alien4.x = (randomNumber(10,390));
    alien4.y = -15;
    alien5.x = (randomNumber(10,390));
    alien5.y = -15;
    spaceship.x = 200;
    spaceship.y = 300;
    bombo.x = randomNumber (10,390);
    bombo.y = randomNumber (-400,-600);
    homeBase.visible = 1;
    homeBase2.visible = 1;
    homeBase3.visible = 1;
    projectile.visible = 1;
    bombo.visible = 1;
    backGround1();
    baseHealth = 8;
    baseHealth2 = 8;
    baseHealth3 = 8;
    score = 0;
    FTL = 0;
    lives = 3;
    bomb = 0;
    alien6health = 2;
  }
}
